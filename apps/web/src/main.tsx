import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './App';
import { initAuth, useAuthState } from './auth';
import { language, useLanguage } from './i18n';
import { ChangePasswordPage, SignInPage } from './pages/SignInPage';
import './styles.css';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 10_000 } } });

/** Sign-in page, the page to choose one's own password, or the app; drawn again when the language changes. */
function Root() {
  const auth = useAuthState();
  const lang = useLanguage();
  if (auth === 'loading') return null;
  if (auth === 'signed-out') return <SignInPage key={lang} />;
  if (auth === 'must-change-password') return <ChangePasswordPage key={lang} />;
  return <App key={lang} />;
}

document.documentElement.lang = language();
void initAuth();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Root />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>
);
