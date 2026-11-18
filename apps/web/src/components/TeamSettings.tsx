import {useState} from 'react';
import useSWR from 'swr';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectItemWithDescription,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  IconSpinner,
} from '@plunk/ui';
import {MembershipSchemas} from '@plunk/shared';
import {MoreVertical, Trash2, UserMinus, UserPlus} from 'lucide-react';
import {AnimatePresence, motion} from 'framer-motion';
import {useForm} from 'react-hook-form';
import {zodResolver} from '@hookform/resolvers/zod';
import type {z} from 'zod';
import {network} from '../lib/network';
import {t} from '../lib/i18n';

interface Member {
  userId: string;
  email: string;
  role: 'OWNER' | 'ADMIN' | 'MEMBER';
}

interface TeamSettingsProps {
  projectId: string;
  currentUserRole: 'OWNER' | 'ADMIN' | 'MEMBER';
  currentUserId: string;
}

type AddMemberForm = z.infer<typeof MembershipSchemas.addMember>;

export function TeamSettings({projectId, currentUserRole, currentUserId}: TeamSettingsProps) {
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [memberToRemove, setMemberToRemove] = useState<Member | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const {data, mutate, isLoading} = useSWR<{success: boolean; data: Member[]}>(
    projectId ? `/projects/${projectId}/members` : null,
    {revalidateOnFocus: false},
  );

  const members = data?.data || [];
  const canManageMembers = currentUserRole === 'OWNER' || currentUserRole === 'ADMIN';

  const form = useForm<AddMemberForm>({
    resolver: zodResolver(MembershipSchemas.addMember),
    defaultValues: {
      email: '',
      role: 'MEMBER',
    },
  });

  const handleAddMember = async (values: AddMemberForm) => {
    setIsSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      await network.fetch<void, typeof MembershipSchemas.addMember>('POST', `/projects/${projectId}/members`, values);
      setSuccess(t('Member added'));
      await mutate();
      form.reset();
      setShowAddDialog(false);

      // Clear success message after 3 seconds
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError(t('Couldn’t add that member. Check the email address and try again.'));
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRemoveMember = async () => {
    if (!memberToRemove) return;

    setIsSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      await network.fetch('DELETE', `/projects/${projectId}/members/${memberToRemove.userId}`);
      setSuccess(t('Member removed'));
      await mutate();
      setMemberToRemove(null);

      // Clear success message after 3 seconds
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError(t('Couldn’t remove that member. Try again.'));
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateRole = async (userId: string, newRole: 'ADMIN' | 'MEMBER') => {
    setError(null);
    setSuccess(null);

    try {
      await network.fetch<void, typeof MembershipSchemas.updateRole>(
        'PATCH',
        `/projects/${projectId}/members/${userId}`,
        {role: newRole},
      );
      setSuccess(t('Role updated'));
      await mutate();

      // Clear success message after 3 seconds
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError(t('Couldn’t change that role. Try again.'));
      }
    }
  };

  const getRoleBadgeVariant = (role: Member['role']) => {
    switch (role) {
      case 'OWNER':
        return 'default';
      case 'ADMIN':
        return 'secondary';
      case 'MEMBER':
        return 'outline';
      default:
        return 'outline';
    }
  };

  return (
    <div className="space-y-6">
      <AnimatePresence mode="wait">
        {success && (
          <motion.div
            key="success"
            initial={{opacity: 0, y: -10}}
            animate={{opacity: 1, y: 0}}
            exit={{opacity: 0}}
            className="p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-800"
          >
            {success}
          </motion.div>
        )}
        {error && (
          <motion.div
            key="error"
            initial={{opacity: 0, y: -10}}
            animate={{opacity: 1, y: 0}}
            exit={{opacity: 0}}
            className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800"
          >
            {error}
          </motion.div>
        )}
      </AnimatePresence>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>{t('Team members')}</CardTitle>
            </div>
            {canManageMembers && (
              <Button
                onClick={() => {
                  setError(null);
                  setShowAddDialog(true);
                }}
              >
                <UserPlus className="mr-2 h-4 w-4" />
                {t('Add member')}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <IconSpinner />
            </div>
          ) : members.length === 0 ? (
            <div className="py-8 text-center text-sm text-neutral-500">{t('No members found')}</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('Email')}</TableHead>
                  <TableHead>{t('Role')}</TableHead>
                  <TableHead className="w-[50px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map(member => {
                  const isCurrentUser = member.userId === currentUserId;
                  const isOwner = member.role === 'OWNER';
                  const canModify = canManageMembers && !isOwner && !isCurrentUser;

                  return (
                    <TableRow key={member.userId}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {member.email}
                          {isCurrentUser && (
                            <Badge variant="outline" className="text-xs">
                              {t('You')}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {canModify ? (
                          <Select
                            value={member.role}
                            onValueChange={value => handleUpdateRole(member.userId, value as 'ADMIN' | 'MEMBER')}
                          >
                            <SelectTrigger className="w-[120px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="ADMIN">{t('Admin')}</SelectItem>
                              <SelectItem value="MEMBER">{t('Member')}</SelectItem>
                            </SelectContent>
                          </Select>
                        ) : (
                          <Badge className={'capitalize'} variant={getRoleBadgeVariant(member.role)}>
                            {member.role.toLowerCase()}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {canModify && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm">
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                className="text-red-600 focus:text-red-600"
                                onClick={() => setMemberToRemove(member)}
                              >
                                <Trash2 className="mr-2 h-4 w-4" />
                                {t('Remove')}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Add Member Dialog */}
      <Dialog
        open={showAddDialog}
        onOpenChange={open => {
          if (!open) {
            setError(null);
          }
          setShowAddDialog(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('Add team member')}</DialogTitle>
            <DialogDescription>
              {t('Add a user to this project by their email address. They must have an existing account.')}
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleAddMember)} className="space-y-4">
              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">{error}</div>
              )}
              <FormField
                control={form.control}
                name="email"
                render={({field}) => (
                  <FormItem>
                    <FormLabel>{t('Email address')}</FormLabel>
                    <FormControl>
                      <Input type="email" placeholder="user@example.com" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="role"
                render={({field}) => (
                  <FormItem>
                    <FormLabel>{t('Role')}</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItemWithDescription
                          value="MEMBER"
                          title={t('Member')}
                          description={t('Can view and use the project')}
                        />
                        <SelectItemWithDescription
                          value="ADMIN"
                          title={t('Admin')}
                          description={t('Can manage settings and members')}
                        />
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setError(null);
                    setShowAddDialog(false);
                  }}
                >
                  {t('Cancel')}
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? t('Adding…') : t('Add Member')}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!memberToRemove}
        onOpenChange={open => !open && setMemberToRemove(null)}
        onConfirm={handleRemoveMember}
        title={t('Remove {email}?', {email: memberToRemove?.email})}
        description={t('They lose access to this project immediately. Their Plunk account is not affected.')}
        icon={UserMinus}
        confirmText={t('Remove member')}
        loadingText={t('Removing…')}
        variant="destructive"
      />
    </div>
  );
}
