import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {StepExecutionStatus, WorkflowExecutionStatus, WorkflowStepType} from '@plunk/db';
import {QueueService} from '../QueueService';
import {WorkflowExecutionService} from '../WorkflowExecutionService';
import {WorkflowService} from '../WorkflowService';
import {factories, getPrismaClient} from '../../../../../test/helpers';

vi.mock('../QueueService', () => ({
  QueueService: {
    queueWorkflowDelayEnd: vi.fn(async () => ({id: 'mock-delay-end-job-id'})),
    queueEmail: vi.fn(async () => ({id: 'mock-email-job-id'})),
    queueWorkflowTimeout: vi.fn(async () => ({id: 'mock-timeout-job-id'})),
    cancelWorkflowTimeout: vi.fn(async () => true),
  },
}));

const DELAY = {type: WorkflowStepType.DELAY, config: {amount: 1, unit: 'hours'}};

let projectId: string;
let contactId: string;
const prisma = getPrismaClient();

/** TRIGGER → optional WEBHOOK → DELAY, with a RUNNING execution. */
async function createRun(config: Record<string, unknown> = DELAY.config, withWebhook = false) {
  const workflow = await factories.createWorkflow({projectId});
  const trigger = await prisma.workflowStep.findFirstOrThrow({
    where: {workflowId: workflow.id, type: WorkflowStepType.TRIGGER},
  });
  const delay = await factories.createWorkflowStep({workflowId: workflow.id, type: DELAY.type, config});
  let previousStepId = trigger.id;
  if (withWebhook) {
    const webhook = await factories.createWorkflowStep({
      workflowId: workflow.id,
      type: WorkflowStepType.WEBHOOK,
      config: {url: 'https://example.com/schedule', saveResponseAs: 'whatsapp'},
    });
    await prisma.workflowTransition.create({data: {fromStepId: trigger.id, toStepId: webhook.id}});
    previousStepId = webhook.id;
  }
  await prisma.workflowTransition.create({data: {fromStepId: previousStepId, toStepId: delay.id}});

  const execution = await prisma.workflowExecution.create({
    data: {workflowId: workflow.id, contactId, status: WorkflowExecutionStatus.RUNNING, currentStepId: trigger.id},
  });

  return {
    workflowId: workflow.id,
    executionId: execution.id,
    delayStepId: delay.id,
    start: () => WorkflowExecutionService.processStepExecution(execution.id, trigger.id),
    endDelay: () => WorkflowExecutionService.processDelayEnd(execution.id, delay.id),
  };
}

type Run = Awaited<ReturnType<typeof createRun>>;

/** Where the run ended up, and how many emails it sent. */
async function outcome(run: Run) {
  const {status} = await prisma.workflowExecution.findUniqueOrThrow({where: {id: run.executionId}});
  const emails = await prisma.email.count({where: {workflowExecutionId: run.executionId}});
  return {status, emails};
}

/**
 * A delay that is the last step used to queue nothing, leaving the execution WAITING forever.
 * It now schedules its own end, which completes the run (or follows a step connected in the meantime).
 */
describe('WorkflowExecutionService - a delay with no step after it', () => {
  beforeEach(async () => {
    const {project} = await factories.createUserWithProject();
    projectId = project.id;
    contactId = (await factories.createContact({projectId, subscribed: true})).id;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('schedules the end of the delay', async () => {
    const run = await createRun();

    await run.start();

    expect(await outcome(run)).toEqual({status: WorkflowExecutionStatus.WAITING, emails: 0});
    expect(QueueService.queueWorkflowDelayEnd).toHaveBeenCalledWith(
      run.executionId,
      run.delayStepId,
      expect.any(String),
      60 * 60 * 1000,
    );
  });

  it('completes the run when the delay ends', async () => {
    const run = await createRun();
    await run.start();

    await run.endDelay();

    expect(await outcome(run)).toEqual({status: WorkflowExecutionStatus.COMPLETED, emails: 0});
    const execution = await prisma.workflowExecution.findUniqueOrThrow({where: {id: run.executionId}});
    expect(execution.currentStepId).toBeNull();
    expect(execution.completedAt).not.toBeNull();
  });

  it('runs a step connected after the delay while the contact was waiting', async () => {
    const run = await createRun();
    await run.start();

    const template = await factories.createTemplate({projectId});
    const send = await factories.createWorkflowStep({
      workflowId: run.workflowId,
      type: WorkflowStepType.SEND_EMAIL,
      templateId: template.id,
    });
    await prisma.workflowTransition.create({data: {fromStepId: run.delayStepId, toStepId: send.id}});

    await run.endDelay();

    expect(await outcome(run)).toEqual({status: WorkflowExecutionStatus.COMPLETED, emails: 1});
  });

  it('leaves a cancelled run cancelled when the delay ends', async () => {
    const run = await createRun();
    await run.start();
    await WorkflowService.cancelExecution(projectId, run.workflowId, run.executionId);

    await run.endDelay();

    expect(await outcome(run)).toEqual({status: WorkflowExecutionStatus.CANCELLED, emails: 0});
  });

  it('does nothing when the run no longer exists', async () => {
    const run = await createRun();
    await run.start();
    await prisma.workflowExecution.delete({where: {id: run.executionId}});

    await expect(run.endDelay()).resolves.toBeUndefined();
  });
});

describe('WorkflowExecutionService - delay until a date', () => {
  const now = new Date('2026-11-18T12:00:00.000Z');

  beforeEach(async () => {
    const {project} = await factories.createUserWithProject();
    projectId = project.id;
    contactId = (await factories.createContact({projectId, subscribed: true})).id;
    vi.setSystemTime(now);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function delayExecution(run: Run) {
    return prisma.workflowStepExecution.findFirstOrThrow({
      where: {executionId: run.executionId, stepId: run.delayStepId},
    });
  }

  it('waits until the date saved by a webhook response', async () => {
    const until = '2026-11-21T08:02:31-03:00';
    const fetcher = WorkflowExecutionService as unknown as {safeFetch: () => Promise<Response>};
    vi.spyOn(fetcher, 'safeFetch').mockResolvedValue(Response.json({enviar_em: until}));
    const run = await createRun({mode: 'until', until: '{{event.whatsapp.enviar_em}}'}, true);

    await run.start();

    expect(await outcome(run)).toEqual({status: WorkflowExecutionStatus.WAITING, emails: 0});
    const step = await delayExecution(run);
    expect(step).toMatchObject({
      status: StepExecutionStatus.COMPLETED,
      output: {until, resumeAt: '2026-11-21T11:02:31.000Z'},
    });
    expect(QueueService.queueWorkflowDelayEnd).toHaveBeenCalledWith(
      run.executionId,
      run.delayStepId,
      step.id,
      Date.parse(until) - now.getTime(),
    );
  });

  it.each(['2026-11-18T11:00:00Z', '2026-11-18T12:00:00Z'])('resumes immediately for %s', async until => {
    const run = await createRun({mode: 'until', until});
    await run.start();

    const step = await delayExecution(run);
    expect(step.output).toEqual({until, resumeAt: now.toISOString()});
    expect(QueueService.queueWorkflowDelayEnd).toHaveBeenCalledWith(run.executionId, run.delayStepId, step.id, 0);

    await run.endDelay();
    expect(await outcome(run)).toEqual({status: WorkflowExecutionStatus.COMPLETED, emails: 0});
  });

  it('processes the next step once if the zero-delay job runs immediately', async () => {
    const run = await createRun({mode: 'until', until: now.toISOString()});
    const template = await factories.createTemplate({projectId});
    const next = await factories.createWorkflowStep({
      workflowId: run.workflowId,
      type: WorkflowStepType.SEND_EMAIL,
      templateId: template.id,
    });
    await prisma.workflowTransition.create({data: {fromStepId: run.delayStepId, toStepId: next.id}});
    vi.mocked(QueueService.queueWorkflowDelayEnd).mockImplementationOnce(async () => {
      await run.endDelay();
      return {id: 'mock-delay-end-job-id'} as Awaited<ReturnType<typeof QueueService.queueWorkflowDelayEnd>>;
    });

    await run.start();

    expect(await outcome(run)).toEqual({status: WorkflowExecutionStatus.COMPLETED, emails: 1});
    expect(await prisma.workflowStepExecution.count({where: {executionId: run.executionId, stepId: next.id}})).toBe(1);
  });

  it.each([
    ['missing variable', {}, /DELAY until: "" is not an ISO 8601 date with a timezone/],
    ['invalid text', {enviar_em: 'abc'}, /"abc" is not an ISO 8601 date with a timezone/],
    ['missing timezone', {enviar_em: '2026-11-19T09:00:00'}, /is not an ISO 8601 date with a timezone/],
    ['more than 365 days', {enviar_em: '2027-11-18T12:00:00.001Z'}, /Delay cannot exceed 365 days/],
  ])('fails the step and execution for %s', async (_label, response, error) => {
    const fetcher = WorkflowExecutionService as unknown as {safeFetch: () => Promise<Response>};
    vi.spyOn(fetcher, 'safeFetch').mockResolvedValue(Response.json(response));
    const run = await createRun({mode: 'until', until: '{{event.whatsapp.enviar_em}}'}, true);

    await expect(run.start()).rejects.toThrow(error);

    expect(await outcome(run)).toEqual({status: WorkflowExecutionStatus.FAILED, emails: 0});
    expect(await delayExecution(run)).toMatchObject({
      status: StepExecutionStatus.FAILED,
      error: expect.stringMatching(error),
    });
    expect(QueueService.queueWorkflowDelayEnd).not.toHaveBeenCalled();
  });
});

/**
 * A delay used to pick the step after it when it started, so a step inserted after the delay while
 * the contact waited was skipped. It now looks the step up when the delay ends.
 */
describe('WorkflowExecutionService - a step inserted after a delay while the contact waits', () => {
  beforeEach(async () => {
    const {project} = await factories.createUserWithProject();
    projectId = project.id;
    contactId = (await factories.createContact({projectId, subscribed: true})).id;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  /** TRIGGER → DELAY → SEND_EMAIL, with the run waiting in the delay */
  async function waitingRun() {
    const run = await createRun();
    const template = await factories.createTemplate({projectId});
    const send = await factories.createWorkflowStep({
      workflowId: run.workflowId,
      type: WorkflowStepType.SEND_EMAIL,
      templateId: template.id,
    });
    const afterDelay = await prisma.workflowTransition.create({data: {fromStepId: run.delayStepId, toStepId: send.id}});
    await run.start();
    return {...run, afterDelay};
  }

  it('runs the inserted step when the delay ends', async () => {
    const run = await waitingRun();
    const template = await factories.createTemplate({projectId});
    await WorkflowService.insertStepOnTransition(projectId, run.workflowId, run.afterDelay.id, {
      type: WorkflowStepType.SEND_EMAIL,
      name: 'Inserted',
      config: {templateId: template.id},
      templateId: template.id,
    });

    // The delay queued its own end, not the step that followed it when it started
    expect(QueueService.queueWorkflowDelayEnd).toHaveBeenCalledWith(
      run.executionId,
      run.delayStepId,
      expect.any(String),
      60 * 60 * 1000,
    );

    await run.endDelay();

    expect(await outcome(run)).toEqual({status: WorkflowExecutionStatus.COMPLETED, emails: 2});
  });

  it('ignores the end of a delay the run has already left', async () => {
    const run = await createRun();
    const second = await factories.createWorkflowStep({workflowId: run.workflowId, ...DELAY});
    await prisma.workflowTransition.create({data: {fromStepId: run.delayStepId, toStepId: second.id}});
    await run.start();
    await run.endDelay();

    // Now waiting in the second delay; a late run of the first one's job must not move it on
    await run.endDelay();

    const execution = await prisma.workflowExecution.findUniqueOrThrow({where: {id: run.executionId}});
    expect(execution).toMatchObject({status: WorkflowExecutionStatus.WAITING, currentStepId: second.id});
    expect(await prisma.workflowStepExecution.count({where: {executionId: run.executionId, stepId: second.id}})).toBe(
      1,
    );
  });
});
