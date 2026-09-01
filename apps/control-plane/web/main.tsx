import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AppRouter } from '../app/routes/AppRouter.js';
import { LoginPage } from '../app/components/login-page.js';
import { basicCredential, clearAuthCredential, clearWorkspaceId, installAuthenticatedFetch, saveAuthCredential } from '../app/components/auth-client.js';
import '../app/globals.css';
import '../app/refined-ui.css';
import '../app/styles/tokens.css';
import '../app/styles/app.css';

type User = { displayName: string; email: string; role?: string };
type AuthMethods = { local?: boolean; oidc?: boolean; oidcUrl?: string };

installAuthenticatedFetch();

async function readAuth(response: Response): Promise<User> {
  if (!response.ok) throw new Error(response.status === 401 ? '用户名或密码不正确。' : '控制平面暂时不可用。');
  return await response.json() as User;
}

function Root() {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);
  const [methods, setMethods] = useState<AuthMethods>({ local: true, oidc: false });

  async function verify(authorization?: string) {
    const response = await fetch('/api/auth/me', { cache: 'no-store', ...(authorization ? { headers: { authorization } } : {}) });
    const current = await readAuth(response);
    setUser(current);
    return current;
  }

  useEffect(() => {
    void verify().catch(() => { clearAuthCredential(); setUser(null); }).finally(async () => {
      try {
        const response = await fetch('/api/auth/methods', { cache: 'no-store' });
        if (response.ok) setMethods(await response.json() as AuthMethods);
      } finally {
        setChecking(false);
      }
    });
  }, []);

  async function login(username: string, password: string) {
    const credential = basicCredential(username.trim(), password);
    await verify(credential);
    saveAuthCredential(credential);
  }

  function signOut() {
    void fetch('/logout', { method: 'POST' }).finally(() => { clearAuthCredential(); clearWorkspaceId(); setUser(null); });
  }

  if (checking) return <main className="auth-loading"><span>TB</span><p>正在恢复安全会话…</p></main>;
  if (!user) return <LoginPage onLogin={login} localEnabled={methods.local !== false} oidcEnabled={methods.oidc === true} oidcUrl={methods.oidcUrl}/>;
  return <AppRouter user={user} onSignOut={signOut}/>;
}

const mount = document.getElementById('root') as HTMLDivElement & { threadBeaconRoot?: ReturnType<typeof createRoot> };
const root = mount.threadBeaconRoot ?? createRoot(mount);
mount.threadBeaconRoot = root;
root.render(<Root/>);
