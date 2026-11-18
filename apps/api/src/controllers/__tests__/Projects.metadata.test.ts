import {Server} from '@overnightjs/core';
import cookieParser from 'cookie-parser';
import type {NextFunction, Request, Response} from 'express';
import request from 'supertest';
import {describe, expect, it} from 'vitest';
import {factories} from '../../../../../test/helpers';
import {jwt} from '../../middleware/auth.js';
import {Projects} from '../Projects.js';

class MetadataServer extends Server {
  constructor() {
    super();
    this.app.use(cookieParser());
    this.addControllers(new Projects());
    this.app.use((error: {code?: number; message?: string}, _req: Request, res: Response, _next: NextFunction) => {
      res.status(error.code || 500).json({error: error.message});
    });
  }
  get handler() { return this.app; }
}

describe('project metadata authorization', () => {
  const app = new MetadataServer().handler;

  it('lists memberships with a session and no selected project, without exposing keys', async () => {
    const {user, project} = await factories.createUserWithProject();
    await factories.createUserWithProject();
    const result = await request(app).get('/projects').set('Cookie', `next_token=${jwt.sign(user.id)}`);
    expect(result.status).toBe(200);
    expect(result.body.data).toHaveLength(1);
    expect(result.body.data[0]).toMatchObject({id: project.id, name: project.name});
    expect(result.body.data[0]).not.toHaveProperty('secret');
    expect(result.body.data[0]).not.toHaveProperty('public');
  });

  it('limits secret keys to their project and refuses public keys', async () => {
    const {project} = await factories.createUserWithProject();
    const {project: other} = await factories.createUserWithProject();
    const result = await request(app).get('/projects').auth(project.secret, {type: 'bearer'});
    expect(result.status).toBe(200);
    expect(result.body.data.id).toBe(project.id);
    expect(result.body.data).not.toHaveProperty('secret');
    expect((await request(app).get(`/projects/${other.id}`).auth(project.secret, {type: 'bearer'})).status).toBe(403);
    expect((await request(app).get('/projects').auth(project.public, {type: 'bearer'})).status).toBe(401);
  });

  it('checks membership on details and rejects unauthenticated requests', async () => {
    const {user, project} = await factories.createUserWithProject();
    const {project: other} = await factories.createUserWithProject();
    const session = `next_token=${jwt.sign(user.id)}`;
    expect((await request(app).get(`/projects/${project.id}`).set('Cookie', session)).status).toBe(200);
    expect((await request(app).get(`/projects/${other.id}`).set('Cookie', session)).status).toBe(404);
    expect((await request(app).get('/projects')).status).toBe(401);
  });
});
