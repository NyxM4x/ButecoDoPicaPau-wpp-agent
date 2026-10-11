import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Page } from '../../components/Layout';
import { Badge, Button, Card, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner, Toggle, toast } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { ROLE_LABEL, dateTime } from '../../lib/format';
import { keys } from '../../lib/queries';
import { useSession } from '../../lib/session';
import type { Role, StaffUserRow } from '../../lib/types';

const ROLE_HINT: Record<Role, string> = {
  admin: 'Todo: menú, promociones, caja, usuarios y configuración.',
  cashier: 'Venta, cobros y caja.',
  kitchen: 'Tablero de cocina y marcar productos agotados.',
};

export function StaffPage() {
  const me = useSession((state) => state.user?.id);
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const staff = useQuery({ queryKey: keys.staff, queryFn: ({ signal }) => api.get<StaffUserRow[]>('/auth/users', signal) });

  const setActive = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => api.patch<StaffUserRow>(`/auth/users/${id}/active`, { active }),
    onError: (error) => toast.error(errorMessage(error)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.staff }),
  });

  return (
    <Page className="max-w-3xl">
      <PageHeader
        title="Usuarios"
        subtitle="Cada persona entra con su usuario: así queda registrado quién movió cada pedido."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" />
            Usuario
          </Button>
        }
      />

      {staff.isPending && (
        <div className="flex justify-center py-16 text-slate-400">
          <Spinner className="h-8 w-8" />
        </div>
      )}
      {staff.isError && <ErrorNote>{errorMessage(staff.error)}</ErrorNote>}

      {staff.data && (
        <Card className="divide-y divide-slate-100">
          {staff.data.map((user) => (
            <div key={user.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 font-semibold">
                  {user.username}
                  <Badge tone={user.role === 'admin' ? 'orange' : 'neutral'}>{ROLE_LABEL[user.role]}</Badge>
                  {user.id === me && <Badge tone="blue">Tú</Badge>}
                </p>
                <p className="text-xs text-slate-500">Creado el {dateTime(user.createdAt)}</p>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Toggle
                  label={`Activo: ${user.username}`}
                  checked={user.isActive}
                  // Desactivarse a uno mismo dejaría el local sin administrador a mitad del turno.
                  disabled={user.id === me || setActive.isPending}
                  onChange={(active) => setActive.mutate({ id: user.id, active })}
                />
                {user.isActive ? 'Activo' : 'Desactivado'}
              </label>
            </div>
          ))}
        </Card>
      )}

      {creating && <StaffForm onClose={() => setCreating(false)} />}
    </Page>
  );
}

function StaffForm({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('cashier');

  const create = useMutation({
    mutationFn: () => api.post<StaffUserRow>('/auth/users', { username: username.trim(), password, role }),
    onSuccess: (user) => {
      toast.ok(`Usuario ${user.username} creado.`);
      void queryClient.invalidateQueries({ queryKey: keys.staff });
      onClose();
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate();
  };

  return (
    <Modal title="Nuevo usuario" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Usuario" hint="Mínimo 3 caracteres.">
          <Input required minLength={3} autoFocus autoComplete="off" value={username} onChange={(event) => setUsername(event.target.value)} />
        </Field>
        <Field label="Contraseña" hint="Mínimo 8 caracteres.">
          <Input required minLength={8} type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </Field>
        <Field label="Rol" hint={ROLE_HINT[role]}>
          <Select value={role} onChange={(event) => setRole(event.target.value as Role)}>
            <option value="cashier">{ROLE_LABEL.cashier}</option>
            <option value="kitchen">{ROLE_LABEL.kitchen}</option>
            <option value="admin">{ROLE_LABEL.admin}</option>
          </Select>
        </Field>
        {create.isError && <ErrorNote>{errorMessage(create.error)}</ErrorNote>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" busy={create.isPending}>
            Crear usuario
          </Button>
        </div>
      </form>
    </Modal>
  );
}
