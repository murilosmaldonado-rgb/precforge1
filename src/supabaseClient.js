import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Cliente principal, usado por toda a aplicação (mantém a sessão de quem
// está logado no navegador).
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Cliente auxiliar, usado apenas quando o administrador cria a conta de um
// novo investidor. Sem "persistSession", ele não substitui a sessão do
// administrador que já está logado.
export const supabaseAdminSignup = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
