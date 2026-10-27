import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './App';
import { initAuth } from './auth';
import './styles.css';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 10_000 } } });
const root = createRoot(document.getElementById('root')!);

initAuth()
  .then(() =>
    root.render(
      <StrictMode>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </QueryClientProvider>
      </StrictMode>
    )
  )
  .catch(() =>
    root.render(
      <div className="error" style={{ margin: 32 }}>
        Cannot reach the sign-in service. Please try again later.
      </div>
    )
  );
