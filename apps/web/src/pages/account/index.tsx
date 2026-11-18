import {useState} from 'react';
import {useForm} from 'react-hook-form';
import {zodResolver} from '@hookform/resolvers/zod';
import type {AuthMethod, Role} from '@plunk/db';
import {UserSchemas} from '@plunk/shared';
import type {AccountUser, ProjectWithRole} from '@plunk/types';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  LoadingState,
} from '@plunk/ui';
import {AlertTriangle} from 'lucide-react';
import {NextSeo} from 'next-seo';
import {toast} from 'sonner';
import {z} from 'zod';

import {DashboardLayout} from '../../components/DashboardLayout';
import {LanguageSettings} from '../../components/LanguageSettings';
import {avatarGradient} from '../../lib/avatar';
import {useProjects} from '../../lib/hooks/useProject';
import {useUser} from '../../lib/hooks/useUser';
import {network} from '../../lib/network';
import {t} from '../../lib/i18n';

const SIGN_IN_METHODS: Record<AuthMethod, string> = {
  PASSWORD: t('Email and password'),
  GITHUB_OAUTH: t('GitHub'),
  GOOGLE_OAUTH: t('Google'),
};

const ROLE_LABELS: Record<Role, string> = {
  OWNER: t('Owner'),
  ADMIN: t('Admin'),
  MEMBER: t('Member'),
};

/**
 * The confirmation field is a client-side guard only, so it lives here rather than in the
 * shared schema the API parses.
 */
const changePasswordForm = UserSchemas.changePassword
  .extend({confirmPassword: z.string()})
  .refine(values => values.newPassword === values.confirmPassword, {
    message: t('Passwords do not match'),
    path: ['confirmPassword'],
  })
  .refine(values => values.newPassword !== values.currentPassword, {
    message: t('Choose a password different from your current one'),
    path: ['newPassword'],
  });

type ChangePasswordForm = z.infer<typeof changePasswordForm>;

/**
 * What is standing between this user and account deletion, phrased for the danger zone.
 * The projects list above already names each project and role, so this only has to
 * summarise rather than repeat it.
 */
function blockingSummary(projects: ProjectWithRole[]): string {
  const owned = projects.filter(project => project.role === 'OWNER').length;
  const joined = projects.length - owned;

  const parts: string[] = [];
  if (owned > 0) {
    parts.push(t('delete the {value}', {value: owned === 1 ? t('project you own') : `${owned} projects you own`}));
  }
  if (joined > 0) {
    parts.push(
      joined === 1
        ? t('ask an owner to remove you from the other one')
        : `ask an owner to remove you from the other ${joined}`,
    );
  }

  return t('To delete your account, {value}.', {value: parts.join(', then ')});
}

function IdentityHeader({user}: {user: AccountUser}) {
  const joined = new Date(user.createdAt).toLocaleDateString(undefined, {month: 'long', year: 'numeric'});

  return (
    <div className="flex items-center gap-4">
      <div
        className="h-11 w-11 shrink-0 rounded-full text-white flex items-center justify-center text-base font-semibold"
        style={{background: avatarGradient(user.email)}}
        aria-hidden="true"
      >
        {user.email.charAt(0).toUpperCase()}
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h2 className="truncate text-base font-semibold text-neutral-900">{user.email}</h2>
          {user.emailVerificationRequired && <Badge variant="warning">{t('Unverified')}</Badge>}
        </div>
        <p className="mt-0.5 text-sm text-neutral-500">
          {SIGN_IN_METHODS[user.type]} <span className="text-neutral-300">·</span> {t('Joined')}{' '}{joined}
        </p>
      </div>
    </div>
  );
}

function ChangePasswordCard() {
  const form = useForm<ChangePasswordForm>({
    resolver: zodResolver(changePasswordForm),
    defaultValues: {currentPassword: '', newPassword: '', confirmPassword: ''},
  });

  const onSubmit = async (values: ChangePasswordForm) => {
    try {
      await network.fetch<{success: boolean}, typeof UserSchemas.changePassword>('POST', '/users/@me/password', {
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      form.reset();
      toast.success(t('Password changed'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Couldn’t change your password. Try again.'));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('Password')}</CardTitle>
        <CardDescription>{t('You stay signed in on this and your other devices.')}</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="max-w-sm space-y-4">
            <FormField
              control={form.control}
              name="currentPassword"
              render={({field}) => (
                <FormItem>
                  <FormLabel>{t('Current password')}</FormLabel>
                  <FormControl>
                    <Input type="password" autoComplete="current-password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="newPassword"
              render={({field}) => (
                <FormItem>
                  <FormLabel>{t('New password')}</FormLabel>
                  <FormControl>
                    <Input type="password" autoComplete="new-password" {...field} />
                  </FormControl>
                  <FormDescription>{t('At least 6 characters.')}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="confirmPassword"
              render={({field}) => (
                <FormItem>
                  <FormLabel>{t('Confirm new password')}</FormLabel>
                  <FormControl>
                    <Input type="password" autoComplete="new-password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? t('Saving…') : t('Change password')}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

export default function Account() {
  const {data: user, mutate: mutateUser} = useUser();
  const {data: projects} = useProjects();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDeleteAccount = async () => {
    setIsDeleting(true);

    try {
      await network.fetch('DELETE', '/users/@me');
      localStorage.removeItem('token');
      localStorage.removeItem('activeProjectId');
      await mutateUser(null, false);
      // A hard navigation, so no SWR state survives into the login page.
      window.location.href = '/auth/login';
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Couldn’t delete your account. Try again.'));
      setShowDeleteDialog(false);
      setIsDeleting(false);
    }
  };

  if (!user || !projects) {
    return (
      <DashboardLayout>
        <LoadingState message={t('Loading your account…')} />
      </DashboardLayout>
    );
  }

  const canDelete = projects.length === 0;
  const sortedProjects = [...projects].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <>
      <NextSeo title={t('Account')} />
      <DashboardLayout>
        <div className="space-y-8">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-neutral-900">{t('Account')}</h1>
            <p className="text-neutral-500 mt-2">{t('Your personal account, separate from any project')}</p>
          </div>

          <div className="max-w-2xl space-y-6">
            <IdentityHeader user={user} />

            <LanguageSettings />

            {/* Projects. Also the reference for the danger zone below, which is why it
                carries the role: it is the list you work through to unblock deletion. */}
            <Card>
              <CardHeader>
                <CardTitle>{t('Projects')}</CardTitle>
                <CardDescription>
                  {projects.length === 0
                    ? t('You are not a member of any project.')
                    : t('You are a member of {value}.', {value: projects.length === 1 ? '1 project' : `${projects.length} projects`})}
                </CardDescription>
              </CardHeader>
              {projects.length > 0 && (
                <CardContent className="p-0">
                  <ul className="divide-y divide-neutral-100 border-t border-neutral-100">
                    {sortedProjects.map(project => (
                      <li key={project.id} className="flex items-center gap-3 px-6 py-3">
                        <div className="h-6 w-6 shrink-0 rounded-md bg-neutral-100 text-neutral-700 flex items-center justify-center text-[11px] font-medium">
                          {project.name.charAt(0).toUpperCase()}
                        </div>
                        <span className="min-w-0 flex-1 truncate text-sm text-neutral-900">{project.name}</span>
                        <span className="shrink-0 text-xs text-neutral-500">{ROLE_LABELS[project.role]}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              )}
            </Card>

            {user.type === 'PASSWORD' && <ChangePasswordCard />}

            {/* Danger zone */}
            <Card className="border-red-200">
              <CardHeader className="border-b border-red-100 bg-red-50">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-white rounded-lg shadow-sm border border-red-200">
                    <AlertTriangle className="h-5 w-5 text-red-600" />
                  </div>
                  <div>
                    <CardTitle className="text-lg text-red-900">{t('Danger zone')}</CardTitle>
                    <CardDescription className="text-red-700">{t('Irreversible actions on your account')}</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="flex items-start justify-between gap-4 px-6 py-5 bg-red-50/40">
                  <div className="flex-1">
                    <h4 className="font-semibold text-red-900">{t('Delete account')}</h4>
                    <p className="mt-1 text-sm text-red-800">
                      {t('Permanently delete your Plunk account. This')}{' '}<strong>{t('cannot be undone')}</strong>.
                    </p>
                    {!canDelete && <p className="mt-2 text-sm text-neutral-600">{blockingSummary(projects)}</p>}
                  </div>
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={!canDelete}
                    onClick={() => setShowDeleteDialog(true)}
                    className="shrink-0"
                  >
                    {t('Delete account')}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        <ConfirmDialog
          open={showDeleteDialog}
          onOpenChange={setShowDeleteDialog}
          onConfirm={handleDeleteAccount}
          title={t('Delete your account?')}
          description={t('This permanently deletes {email}. It cannot be undone, and you will need to sign up again to use Plunk.', {email: user.email})}
          confirmPhrase="DELETE"
          confirmText={t('Delete account')}
          loadingText={t('Deleting…')}
          variant="destructive"
          status={isDeleting ? 'loading' : 'idle'}
        />

      </DashboardLayout>
    </>
  );
}
