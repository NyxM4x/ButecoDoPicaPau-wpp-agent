import { useState, type FormEvent } from 'react';
import { Button, ErrorNote, Field, Input } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { useRestaurantName } from '../lib/restaurant';
import { useSession } from '../lib/session';
import type { LoginResponse } from '../lib/types';

export function LoginPage() {
  const login = useSession((state) => state.login);
  const restaurantName = useRestaurantName();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const session = await api.post<LoginResponse>('/auth/login', { username: username.trim(), password });
      login(session.accessToken, session.user);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-full items-center justify-center bg-slate-900 p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-6 shadow-xl">
        <div>
          <h1 className="text-xl font-bold tracking-tight">{restaurantName}</h1>
          <p className="text-sm text-slate-500">Ingresa con tu usuario del local.</p>
        </div>
        <Field label="Usuario">
          <Input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" autoFocus required />
        </Field>
        <Field label="Contraseña">
          <Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required />
        </Field>
        {error && <ErrorNote>{error}</ErrorNote>}
        <Button type="submit" size="lg" className="w-full" busy={busy}>
          Ingresar
        </Button>
      </form>
    </div>
  );
}
