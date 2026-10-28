import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './App';
import { initAuth, keycloak } from './auth';
import { applyAccountLanguage, language, t, useLanguage } from './i18n';
import './styles.css';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 10_000 } } });
const root = createRoot(document.getElementById('root')!);

/** Draws the app again in the new language when it changes (screens keep their data in the query cache). */
function Localised() {
  const language = useLanguage();
  return <App key={language} />;
}

initAuth()
  .then(() => {
    // The language chosen on the sign-in page, until the person picks one in the app.
    applyAccountLanguage(keycloak.tokenParsed?.locale);
    document.documentElement.lang = language();
    root.render(
      <StrictMode>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <Localised />
          </BrowserRouter>
        </QueryClientProvider>
      </StrictMode>
    );
  })
  .catch(() =>
    root.render(
      <div className="error" style={{ margin: 32 }}>
        {t('Cannot reach the sign-in service. Please try again later.')}
      </div>
    )
  );
