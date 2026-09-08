import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Cliente principal, usado por toda a aplicação. Usa sessionStorage (em vez
// do localStorage padrão) para guardar a sessão: assim, fechar a aba/janela
// do navegador encerra o login. Recarregar a página (F5) continua logado
// normalmente, pois o sessionStorage sobrevive a isso — só não sobrevive ao
// fechamento real do navegador.
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { storage: window.sessionStorage },
});

// Cliente auxiliar, usado apenas quando o administrador cria a conta de um
// novo investidor. Sem "persistSession", ele não substitui a sessão do
// administrador que já está logado.
export const supabaseAdminSignup = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
