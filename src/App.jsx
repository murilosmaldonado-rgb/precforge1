import React, { useState, useMemo, useEffect, useRef } from "react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  BarChart, Bar, PieChart, Pie, Cell, Legend, AreaChart, Area
} from "recharts";
import * as XLSX from "xlsx";
import {
  LayoutDashboard, Wallet, TrendingUp, History, FileText, User, LogOut,
  Users, ClipboardList, BarChart3, Settings, Search, Plus, X, Check, Ban,
  KeyRound, Download, Filter, ChevronRight, Eye, EyeOff, Flame, ShieldCheck,
  ArrowUpRight, ArrowDownRight, Pencil, FileSpreadsheet, FileDown, Bell,
  ChevronDown, AlertCircle, Menu, Anvil, Scale, Building2, Lock
} from "lucide-react";
import { supabase, supabaseAdminSignup } from "./supabaseClient";

/* =========================================================================
   PRECFORGE — plataforma de gestão de investimentos em precatórios
   Conectada a um banco de dados real via Supabase (autenticação + Postgres
   com Row Level Security). Os componentes de tela abaixo são os mesmos da
   versão de demonstração; o que mudou é de onde os dados vêm (App()).
   ========================================================================= */

/* ---------------------------- Helpers de formato ------------------------ */

const formatBRL = (v) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    Number.isFinite(v) ? v : 0
  );

const formatNumberBR = (v, d = 2) =>
  Number(v).toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });

const formatPercent = (v, suffix = "") =>
  `${formatNumberBR(v)}%${suffix}`;

const toDate = (s) => {
  if (s instanceof Date) return s;
  // Aceita tanto uma data simples ("2026-01-10") quanto um timestamp
  // completo vindo do banco ("2026-01-10T14:32:00.000Z").
  if (typeof s === "string" && s.includes("T")) return new Date(s);
  return new Date(`${s}T00:00:00`);
};

const formatDateBR = (s) => toDate(s).toLocaleDateString("pt-BR");

const formatDateShort = (d) =>
  d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });

const genId = (p = "id") => `${p}_${Math.random().toString(36).slice(2, 9)}`;

const daysBetween = (a, b) => Math.round((b.getTime() - a.getTime()) / 86400000);

const addDays = (d, n) => new Date(d.getTime() + n * 86400000);

/* ---------------------------- Motor de cálculo --------------------------- */
// Valor Atual = Valor Investido x (1 + taxa)^(dias/365) — juros compostos

function currentValueAt(investment, asOf) {
  const start = toDate(investment.dataAplicacao);
  const days = Math.max(0, daysBetween(start, asOf));
  const years = days / 365;
  return investment.valorInvestido * Math.pow(1 + investment.taxa, years);
}

function accruedPercent(investment, asOf) {
  const v = currentValueAt(investment, asOf);
  return (v / investment.valorInvestido - 1) * 100;
}

function buildInvestmentSeries(investment, rangeKey) {
  const now = new Date();
  const start = toDate(investment.dataAplicacao);
  const monthsBack = { "1m": 1, "3m": 3, "6m": 6, "1a": 12 }[rangeKey];
  let seriesStart = start;
  if (monthsBack) {
    const cutoff = new Date(now);
    cutoff.setMonth(cutoff.getMonth() - monthsBack);
    seriesStart = cutoff > start ? cutoff : start;
  }
  const totalDays = Math.max(1, daysBetween(seriesStart, now));
  const points = Math.min(30, Math.max(6, Math.round(totalDays / 5)));
  const data = [];
  for (let i = 0; i <= points; i++) {
    const d = addDays(seriesStart, Math.round((totalDays * i) / points));
    data.push({
      dateObj: d,
      label: formatDateShort(d),
      valor: Math.round(currentValueAt(investment, d) * 100) / 100,
    });
  }
  return data;
}

function buildPortfolioSeries(investments, rangeKey) {
  if (investments.length === 0) return [];
  const now = new Date();
  const earliest = investments.reduce(
    (min, inv) => (toDate(inv.dataAplicacao) < min ? toDate(inv.dataAplicacao) : min),
    toDate(investments[0].dataAplicacao)
  );
  const monthsBack = { "1m": 1, "3m": 3, "6m": 6, "1a": 12 }[rangeKey];
  let seriesStart = earliest;
  if (monthsBack) {
    const cutoff = new Date(now);
    cutoff.setMonth(cutoff.getMonth() - monthsBack);
    seriesStart = cutoff > earliest ? cutoff : earliest;
  }
  const totalDays = Math.max(1, daysBetween(seriesStart, now));
  const points = Math.min(36, Math.max(8, Math.round(totalDays / 5)));
  const data = [];
  for (let i = 0; i <= points; i++) {
    const d = addDays(seriesStart, Math.round((totalDays * i) / points));
    let total = 0;
    investments.forEach((inv) => {
      if (toDate(inv.dataAplicacao) <= d) total += currentValueAt(inv, d);
    });
    data.push({ dateObj: d, label: formatDateShort(d), valor: Math.round(total * 100) / 100 });
  }
  return data;
}

/* ------------------------------- Tipos fixos ------------------------------ */

const TIPOS_INVESTIMENTO = [
  "Precatório Federal",
  "Precatório Estadual",
  "Precatório Municipal",
  "Direito Creditório Trabalhista",
  "Direito Creditório Cível",
];

/* --------------------- Tradução banco (snake_case) <-> tela -------------------- */
// As tabelas no Supabase usam snake_case (padrão SQL); as telas abaixo foram
// construídas esperando camelCase. Estas funções fazem a ponte nos dois sentidos.

function mapProfile(row) {
  return {
    id: row.id,
    nome: row.nome || row.email,
    cpfCnpj: row.cpf_cnpj || "",
    email: row.email,
    telefone: row.telefone || "",
    role: row.role,
    status: row.status,
    createdAt: row.created_at,
    banco: row.banco || "",
    agencia: row.agencia || "",
    conta: row.conta || "",
    tipoConta: row.tipo_conta || "Corrente",
    titular: row.titular || "",
    cpfTitular: row.cpf_titular || "",
    chavePix: row.chave_pix || "",
  };
}

function mapInvestment(row) {
  return {
    id: row.id,
    userId: row.user_id,
    nome: row.nome,
    tipo: row.tipo,
    valorInvestido: Number(row.valor_investido),
    dataAplicacao: row.data_aplicacao,
    taxa: Number(row.taxa),
    tipoTaxa: row.tipo_taxa,
    prazoMeses: row.prazo_meses,
    dataVencimento: row.data_vencimento,
    status: row.status,
    observacoes: row.observacoes || "",
  };
}

function mapTransaction(row) {
  return {
    id: row.id,
    investmentId: row.investment_id,
    userId: row.user_id,
    tipo: row.tipo,
    valor: Number(row.valor || 0),
    data: row.data,
    descricao: row.descricao || "",
  };
}

function mapDocument(row) {
  return {
    id: row.id,
    userId: row.user_id,
    investmentId: row.investment_id,
    nome: row.nome,
    tipo: row.tipo || "",
    dataUpload: row.data_upload,
  };
}

function mapAuditLog(row) {
  return {
    id: row.id,
    adminId: row.admin_id,
    acao: row.acao,
    entidade: row.entidade,
    entidadeId: row.entidade_id,
    data: row.data,
    detalhes: row.detalhes || "",
  };
}

/* ------------------------------- Ícones/UI -------------------------------- */

const NAV_INVESTOR = [
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { key: "carteira", label: "Minha Carteira", icon: Wallet },
  { key: "historico", label: "Histórico", icon: History },
  { key: "documentos", label: "Documentos", icon: FileText },
  { key: "perfil", label: "Perfil", icon: User },
];

const NAV_ADMIN = [
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { key: "investidores", label: "Investidores", icon: Users },
  { key: "investimentos", label: "Investimentos", icon: ClipboardList },
  { key: "movimentacoes", label: "Movimentações", icon: History },
  { key: "relatorios", label: "Relatórios", icon: BarChart3 },
  { key: "logs", label: "Logs", icon: ShieldCheck },
  { key: "configuracoes", label: "Configurações", icon: Settings },
];

function ForgeMark({ size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none">
      <circle cx="24" cy="24" r="22" stroke="var(--ember)" strokeWidth="1.4" opacity="0.5" />
      <path d="M14 32 L24 14 L34 32 Z" stroke="var(--text)" strokeWidth="1.6" fill="none" strokeLinejoin="round" />
      <path
        d="M24 14 C22 19 27 20 24.5 24 C22.5 27 25.5 28.5 24 32"
        stroke="var(--ember)"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
        className="pf-flame-path"
      />
    </svg>
  );
}

function Badge({ status }) {
  const map = {
    Ativo: "pf-badge-green",
    Liquidado: "pf-badge-blue",
    "Em análise": "pf-badge-amber",
    Suspenso: "pf-badge-red",
    Bloqueado: "pf-badge-red",
  };
  return <span className={`pf-badge ${map[status] || "pf-badge-neutral"}`}>{status}</span>;
}

function Delta({ value }) {
  const positive = value >= 0;
  return (
    <span className={`pf-delta ${positive ? "pf-delta-up" : "pf-delta-down"}`}>
      {positive ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
      {formatPercent(Math.abs(value))}
    </span>
  );
}

function Card({ title, icon: Icon, children, accent, className = "" }) {
  return (
    <div className={`pf-card ${className}`}>
      {(title || Icon) && (
        <div className="pf-card-head">
          {Icon && <Icon size={16} className="pf-card-icon" />}
          <span>{title}</span>
        </div>
      )}
      <div className={accent ? "pf-card-accent" : undefined}>{children}</div>
    </div>
  );
}

function Modal({ title, onClose, children, wide }) {
  return (
    <div className="pf-modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`pf-modal ${wide ? "pf-modal-wide" : ""}`}>
        <div className="pf-modal-head">
          <h3>{title}</h3>
          <button className="pf-icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="pf-modal-body">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="pf-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="pf-tooltip">
      <div className="pf-tooltip-label">{label}</div>
      <div className="pf-tooltip-value">{formatBRL(payload[0].value)}</div>
    </div>
  );
}

/* -------------------------------- Toasts ---------------------------------- */

function ToastStack({ toasts }) {
  return (
    <div className="pf-toast-stack">
      {toasts.map((t) => (
        <div key={t.id} className={`pf-toast pf-toast-${t.type || "info"}`}>
          {t.type === "success" ? <Check size={16} /> : <AlertCircle size={16} />}
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------ Loading screen ----------------------------- */

function LoadingScreen() {
  return (
    <div className="pf-loading">
      <div className="pf-loading-mark">
        <ForgeMark size={64} />
      </div>
      <div className="pf-loading-word">PrecForge</div>
      <div className="pf-loading-bar"><div className="pf-loading-bar-fill" /></div>
      <div className="pf-loading-caption">Consolidando sua carteira…</div>
    </div>
  );
}

/* -------------------------------- Login ------------------------------------ */

function LoginScreen({ onLogin }) {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await onLogin(email.trim(), senha);
    } catch (err) {
      setError(err.message || "Não foi possível entrar. Tente novamente.");
    } finally {
      setSubmitting(false);
    }
  }

  async function sendResetEmail() {
    if (!email.trim()) {
      setError("Digite seu e-mail acima e clique novamente em \"Esqueci minha senha\".");
      return;
    }
    await supabase.auth.resetPasswordForEmail(email.trim());
    setForgotSent(true);
  }

  return (
    <div className="pf-login">
      <div className="pf-login-side">
        <div className="pf-login-side-inner">
          <div className="pf-brand">
            <ForgeMark />
            <span>PrecForge</span>
          </div>
          <h1>Precatórios forjados em resultado.</h1>
          <p>
            Gestão institucional de investimentos em precatórios e direitos creditórios,
            com transparência total sobre cada real aplicado.
          </p>
          <div className="pf-login-stats">
            <div><Scale size={16} /><span>Carteiras auditadas</span></div>
            <div><Building2 size={16} /><span>Operações federais, estaduais e municipais</span></div>
            <div><Lock size={16} /><span>Acesso segregado por investidor</span></div>
          </div>
        </div>
      </div>
      <div className="pf-login-form-wrap">
        <form className="pf-login-form" onSubmit={submit}>
          <div className="pf-brand pf-brand-mobile">
            <ForgeMark size={22} />
            <span>PrecForge</span>
          </div>
          <h2>Entrar na plataforma</h2>
          <p className="pf-login-sub">Acesse sua carteira de investimentos.</p>

          <Field label="E-mail">
            <input
              type="email"
              placeholder="voce@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              required
            />
          </Field>
          <Field label="Senha">
            <div className="pf-input-with-icon">
              <input
                type={showPw ? "text" : "password"}
                placeholder="••••••••"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                autoComplete="current-password"
                required
              />
              <button type="button" className="pf-icon-btn" onClick={() => setShowPw((s) => !s)}>
                {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </Field>

          {error && <div className="pf-error"><AlertCircle size={14} /> {error}</div>}

          <button type="submit" className="pf-btn pf-btn-primary pf-btn-block" disabled={submitting}>
            {submitting ? "Entrando…" : "Entrar"}
          </button>
          <button type="button" className="pf-link" onClick={() => { setForgotOpen(true); setForgotSent(false); }}>
            Esqueci minha senha
          </button>
        </form>
      </div>

      {forgotOpen && (
        <Modal title="Recuperar senha" onClose={() => setForgotOpen(false)}>
          {forgotSent ? (
            <p className="pf-modal-text">
              Se houver uma conta cadastrada com o e-mail <strong>{email}</strong>, enviamos um
              link para redefinição de senha. Verifique também a caixa de spam.
            </p>
          ) : (
            <p className="pf-modal-text">
              Vamos enviar um link de redefinição de senha para <strong>{email || "o e-mail informado acima"}</strong>.
            </p>
          )}
          <button className="pf-btn pf-btn-primary" onClick={forgotSent ? () => setForgotOpen(false) : sendResetEmail}>
            {forgotSent ? "Entendi" : "Enviar link"}
          </button>
        </Modal>
      )}
    </div>
  );
}

/* ------------------------------ Definir nova senha -------------------------- */
// Tela mostrada quando a pessoa chega pelo link de e-mail (redefinição de
// senha ou primeiro acesso de um investidor recém-criado).

function SetNewPasswordScreen({ onDone }) {
  const [senha, setSenha] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (senha.length < 6) {
      setError("A senha precisa ter pelo menos 6 caracteres.");
      return;
    }
    if (senha !== confirmar) {
      setError("As senhas não coincidem.");
      return;
    }
    setSubmitting(true);
    const { error: err } = await supabase.auth.updateUser({ password: senha });
    setSubmitting(false);
    if (err) {
      setError(err.message || "Não foi possível definir a senha. O link pode ter expirado — peça um novo.");
      return;
    }
    onDone();
  }

  return (
    <div className="pf-login">
      <div className="pf-login-side">
        <div className="pf-login-side-inner">
          <div className="pf-brand"><ForgeMark /><span>PrecForge</span></div>
          <h1>Quase lá.</h1>
          <p>Defina sua senha de acesso para continuar.</p>
        </div>
      </div>
      <div className="pf-login-form-wrap">
        <form className="pf-login-form" onSubmit={submit}>
          <div className="pf-brand pf-brand-mobile"><ForgeMark size={22} /><span>PrecForge</span></div>
          <h2>Defina sua senha</h2>
          <p className="pf-login-sub">Escolha uma senha para acessar sua conta na PrecForge.</p>
          <Field label="Nova senha">
            <input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} required minLength={6} placeholder="••••••••" />
          </Field>
          <Field label="Confirmar nova senha">
            <input type="password" value={confirmar} onChange={(e) => setConfirmar(e.target.value)} required minLength={6} placeholder="••••••••" />
          </Field>
          {error && <div className="pf-error"><AlertCircle size={14} /> {error}</div>}
          <button type="submit" className="pf-btn pf-btn-primary pf-btn-block" disabled={submitting}>
            {submitting ? "Salvando…" : "Salvar senha e entrar"}
          </button>
        </form>
      </div>
    </div>
  );
}

/* --------------------------------- Sidebar --------------------------------- */

function Sidebar({ role, page, setPage, onLogout, open, setOpen }) {
  const items = role === "master" ? NAV_ADMIN : NAV_INVESTOR;
  return (
    <>
      {open && <div className="pf-drawer-scrim" onClick={() => setOpen(false)} />}
      <aside className={`pf-sidebar ${open ? "pf-sidebar-open" : ""}`}>
        <div className="pf-brand pf-sidebar-brand">
          <ForgeMark size={24} />
          <span>PrecForge</span>
        </div>
        <nav className="pf-nav">
          {items.map((it) => (
            <button
              key={it.key}
              className={`pf-nav-item ${page === it.key ? "pf-nav-item-active" : ""}`}
              onClick={() => { setPage(it.key); setOpen(false); }}
            >
              <it.icon size={17} />
              <span>{it.label}</span>
              {page === it.key && <span className="pf-nav-active-dot" />}
            </button>
          ))}
        </nav>
        <button className="pf-nav-item pf-nav-item-logout" onClick={onLogout}>
          <LogOut size={17} />
          <span>Sair</span>
        </button>
      </aside>
    </>
  );
}

/* --------------------------------- Topbar ---------------------------------- */

function Topbar({ user, title, onMenu, search, onSearch }) {
  return (
    <header className="pf-topbar">
      <button className="pf-icon-btn pf-only-mobile" onClick={onMenu}><Menu size={20} /></button>
      <h1>{title}</h1>
      <div className="pf-topbar-right">
        {onSearch && (
          <div className="pf-search">
            <Search size={15} />
            <input placeholder="Buscar…" value={search} onChange={(e) => onSearch(e.target.value)} />
          </div>
        )}
        <button className="pf-icon-btn"><Bell size={17} /></button>
        <div className="pf-avatar" title={user.nome}>{user.nome.split(" ").map((p) => p[0]).slice(0, 2).join("")}</div>
      </div>
    </header>
  );
}

/* ------------------------------ Range selector ------------------------------ */

function RangeTabs({ value, onChange }) {
  const opts = [["1m", "1M"], ["3m", "3M"], ["6m", "6M"], ["1a", "1A"], ["tudo", "Tudo"]];
  return (
    <div className="pf-range-tabs">
      {opts.map(([k, l]) => (
        <button key={k} className={`pf-range-tab ${value === k ? "pf-range-tab-active" : ""}`} onClick={() => onChange(k)}>
          {l}
        </button>
      ))}
    </div>
  );
}

/* ============================ INVESTOR: DASHBOARD ============================ */

function InvestorDashboard({ user, investments, onOpenInvestment }) {
  const [range, setRange] = useState("6m");
  const myInvestments = investments.filter((i) => i.userId === user.id);
  const now = new Date();

  const saldoInvestido = myInvestments.reduce((s, i) => s + i.valorInvestido, 0);
  const saldoAtual = myInvestments.reduce((s, i) => s + currentValueAt(i, now), 0);
  const rentabilidadeTotal = saldoInvestido > 0 ? (saldoAtual / saldoInvestido - 1) * 100 : 0;

  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const saldoInicioMes = myInvestments.reduce(
    (s, i) => s + (toDate(i.dataAplicacao) <= startOfMonth ? currentValueAt(i, startOfMonth) : i.valorInvestido),
    0
  );
  const rentabilidadePeriodo = saldoInicioMes > 0 ? (saldoAtual / saldoInicioMes - 1) * 100 : 0;

  const series = useMemo(() => buildPortfolioSeries(myInvestments, range), [myInvestments, range]);

  return (
    <div className="pf-page">
      <div className="pf-greeting">
        <h2>Olá, {user.nome.split(" ")[0]}</h2>
        <p>Este é o resumo consolidado da sua carteira em PrecForge.</p>
      </div>

      <div className="pf-cards-grid">
        <Card title="Saldo investido" icon={Wallet}>
          <div className="pf-metric">{formatBRL(saldoInvestido)}</div>
          <span className="pf-metric-sub">Total originalmente aplicado</span>
        </Card>
        <Card title="Saldo atual" icon={TrendingUp} accent>
          <div className="pf-metric pf-metric-accent">{formatBRL(saldoAtual)}</div>
          <span className="pf-metric-sub">Atualizado com rentabilidade acumulada</span>
        </Card>
        <Card title="Rentabilidade total">
          <div className="pf-metric"><Delta value={rentabilidadeTotal} /></div>
          <span className="pf-metric-sub">Desde a aplicação</span>
        </Card>
        <Card title="Rentabilidade no período">
          <div className="pf-metric"><Delta value={rentabilidadePeriodo} /></div>
          <span className="pf-metric-sub">Mês corrente</span>
        </Card>
      </div>

      <Card className="pf-chart-card">
        <div className="pf-chart-head">
          <div>
            <div className="pf-chart-title">Evolução do patrimônio</div>
            <div className="pf-chart-value">{formatBRL(saldoAtual)}</div>
          </div>
          <RangeTabs value={range} onChange={setRange} />
        </div>
        <div className="pf-chart-body">
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={series} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="pfGreen" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#34D399" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#34D399" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 6" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: "var(--text-faint)", fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={30} />
              <YAxis tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} tick={{ fill: "var(--text-faint)", fontSize: 11 }} axisLine={false} tickLine={false} width={44} />
              <Tooltip content={<ChartTooltip />} />
              <Area type="monotone" dataKey="valor" stroke="#34D399" strokeWidth={2} fill="url(#pfGreen)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card title="Meus investimentos" icon={Wallet}>
        <div className="pf-mini-list">
          {myInvestments.map((inv) => {
            const rent = accruedPercent(inv, now);
            return (
              <button key={inv.id} className="pf-mini-row" onClick={() => onOpenInvestment(inv)}>
                <div className="pf-mini-row-main">
                  <div className="pf-mini-row-name">{inv.nome}</div>
                  <div className="pf-mini-row-sub">{formatDateBR(inv.dataAplicacao)} · {formatPercent(inv.taxa * 100, " a.a.")}</div>
                </div>
                <div className="pf-mini-row-value">
                  <div>{formatBRL(currentValueAt(inv, now))}</div>
                  <Delta value={rent} />
                </div>
                <ChevronRight size={16} className="pf-mini-row-chevron" />
              </button>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

/* ============================ Dados bancários (investidor) ============================ */

function BankAccountCard({ user, onSave }) {
  const [form, setForm] = useState({
    banco: user.banco || "",
    agencia: user.agencia || "",
    conta: user.conta || "",
    tipoConta: user.tipoConta || "Corrente",
    titular: user.titular || user.nome || "",
    cpfTitular: user.cpfTitular || user.cpfCnpj || "",
    chavePix: user.chavePix || "",
  });
  const [saving, setSaving] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    await onSave(form);
    setSaving(false);
  }

  return (
    <Card title="Dados bancários para recebimento" icon={Wallet}>
      <p className="pf-report-desc">
        Esses dados serão usados para o pagamento do seu provento na data de vencimento de
        cada operação.
      </p>
      <form className="pf-form pf-form-grid" onSubmit={submit}>
        <Field label="Banco">
          <input required value={form.banco} onChange={(e) => setForm({ ...form, banco: e.target.value })} placeholder="Ex: Banco do Brasil" />
        </Field>
        <Field label="Tipo de conta">
          <select value={form.tipoConta} onChange={(e) => setForm({ ...form, tipoConta: e.target.value })}>
            <option>Corrente</option>
            <option>Poupança</option>
          </select>
        </Field>
        <Field label="Agência">
          <input required value={form.agencia} onChange={(e) => setForm({ ...form, agencia: e.target.value })} placeholder="0001" />
        </Field>
        <Field label="Conta (com dígito)">
          <input required value={form.conta} onChange={(e) => setForm({ ...form, conta: e.target.value })} placeholder="12345-6" />
        </Field>
        <Field label="Nome do titular">
          <input required value={form.titular} onChange={(e) => setForm({ ...form, titular: e.target.value })} />
        </Field>
        <Field label="CPF/CNPJ do titular">
          <input required value={form.cpfTitular} onChange={(e) => setForm({ ...form, cpfTitular: e.target.value })} />
        </Field>
        <Field label="Chave PIX (opcional)">
          <input value={form.chavePix} onChange={(e) => setForm({ ...form, chavePix: e.target.value })} placeholder="CPF, e-mail, telefone ou chave aleatória" />
        </Field>
        <button className="pf-btn pf-btn-primary pf-form-span" type="submit" disabled={saving} style={{ justifySelf: "start" }}>
          {saving ? "Salvando…" : "Salvar dados bancários"}
        </button>
      </form>
    </Card>
  );
}

/* ============================ INVESTOR: CARTEIRA ============================= */

function InvestorCarteira({ user, investments, onOpenInvestment, onSaveBankInfo }) {
  const myInvestments = investments.filter((i) => i.userId === user.id);
  const now = new Date();
  return (
    <div className="pf-page">
      <div className="pf-page-head">
        <h2>Minha Carteira</h2>
        <p>Todos os seus investimentos ativos em precatórios e direitos creditórios.</p>
      </div>
      <Card>
        <div className="pf-table-wrap">
          <table className="pf-table">
            <thead>
              <tr>
                <th>Investimento</th>
                <th>Data da aplicação</th>
                <th>Valor investido</th>
                <th>Taxa contratada</th>
                <th>Prazo</th>
                <th>Rentab. acumulada</th>
                <th>Valor atual</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {myInvestments.map((inv) => (
                <tr key={inv.id} onClick={() => onOpenInvestment(inv)} className="pf-row-clickable">
                  <td className="pf-cell-strong">{inv.nome}</td>
                  <td>{formatDateBR(inv.dataAplicacao)}</td>
                  <td className="pf-mono">{formatBRL(inv.valorInvestido)}</td>
                  <td className="pf-mono">{formatPercent(inv.taxa * 100, " a.a.")}</td>
                  <td>{inv.prazoMeses} meses</td>
                  <td className="pf-mono"><Delta value={accruedPercent(inv, now)} /></td>
                  <td className="pf-mono pf-cell-strong">{formatBRL(currentValueAt(inv, now))}</td>
                  <td><Badge status={inv.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <BankAccountCard user={user} onSave={onSaveBankInfo} />
    </div>
  );
}

/* ============================== DETALHE MODAL ================================ */

function InvestmentDetailModal({ investment, onClose }) {
  const [range, setRange] = useState("6m");
  const now = new Date();
  const valorAtual = currentValueAt(investment, now);
  const rent = accruedPercent(investment, now);
  const series = useMemo(() => buildInvestmentSeries(investment, range), [investment, range]);

  return (
    <Modal title={investment.nome} onClose={onClose} wide>
      <div className="pf-detail-grid">
        <div className="pf-detail-facts">
          <div><span>Valor aplicado</span><strong>{formatBRL(investment.valorInvestido)}</strong></div>
          <div><span>Data da aplicação</span><strong>{formatDateBR(investment.dataAplicacao)}</strong></div>
          <div><span>Taxa contratada</span><strong>{formatPercent(investment.taxa * 100, ` a.a. (${investment.tipoTaxa})`)}</strong></div>
          <div><span>Rentabilidade acumulada</span><strong><Delta value={rent} /></strong></div>
          <div><span>Valor atual</span><strong className="pf-text-accent">{formatBRL(valorAtual)}</strong></div>
          <div><span>Prazo da operação</span><strong>{investment.prazoMeses} meses</strong></div>
          <div><span>Data prevista de liquidação</span><strong>{formatDateBR(investment.dataVencimento)}</strong></div>
          <div><span>Status</span><strong><Badge status={investment.status} /></strong></div>
          {investment.observacoes && (
            <div className="pf-detail-obs"><span>Observações</span><p>{investment.observacoes}</p></div>
          )}
        </div>
        <div className="pf-detail-chart">
          <RangeTabs value={range} onChange={setRange} />
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={series} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 6" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: "var(--text-faint)", fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={24} />
              <YAxis tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} tick={{ fill: "var(--text-faint)", fontSize: 11 }} axisLine={false} tickLine={false} width={44} />
              <Tooltip content={<ChartTooltip />} />
              <Line type="monotone" dataKey="valor" stroke="#34D399" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </Modal>
  );
}

/* ============================== INVESTOR: HISTÓRICO =========================== */

function InvestorHistorico({ user, transactions, investments }) {
  const myTx = transactions
    .filter((t) => t.userId === user.id)
    .sort((a, b) => new Date(b.data) - new Date(a.data));
  const nameOf = (id) => investments.find((i) => i.id === id)?.nome || "—";
  return (
    <div className="pf-page">
      <div className="pf-page-head">
        <h2>Histórico</h2>
        <p>Eventos e movimentações relacionados aos seus investimentos.</p>
      </div>
      <Card>
        <div className="pf-timeline">
          {myTx.map((t) => (
            <div key={t.id} className="pf-timeline-item">
              <div className="pf-timeline-dot" />
              <div className="pf-timeline-content">
                <div className="pf-timeline-top">
                  <strong>{t.tipo}</strong>
                  <span>{formatDateBR(t.data)}</span>
                </div>
                <div className="pf-timeline-desc">{t.descricao}</div>
                <div className="pf-timeline-meta">
                  {nameOf(t.investmentId)}{t.valor > 0 ? ` · ${formatBRL(t.valor)}` : ""}
                </div>
              </div>
            </div>
          ))}
          {myTx.length === 0 && <div className="pf-empty">Nenhuma movimentação registrada.</div>}
        </div>
      </Card>
    </div>
  );
}

/* ============================== INVESTOR: DOCUMENTOS =========================== */

function InvestorDocumentos({ user, documents, investments, addToast }) {
  const myDocs = documents.filter((d) => d.userId === user.id);
  const nameOf = (id) => investments.find((i) => i.id === id)?.nome || "—";
  return (
    <div className="pf-page">
      <div className="pf-page-head">
        <h2>Documentos</h2>
        <p>Contratos, termos e comprovantes vinculados à sua conta.</p>
      </div>
      <Card>
        <div className="pf-doc-list">
          {myDocs.map((d) => (
            <div key={d.id} className="pf-doc-row">
              <FileText size={18} className="pf-doc-icon" />
              <div className="pf-doc-info">
                <div className="pf-doc-name">{d.nome}</div>
                <div className="pf-doc-meta">{d.tipo} · {nameOf(d.investmentId)} · enviado em {formatDateBR(d.dataUpload)}</div>
              </div>
              <button
                className="pf-btn pf-btn-ghost pf-btn-sm"
                onClick={() => addToast("Download simulado — em produção, o arquivo real seria baixado.", "info")}
              >
                <Download size={14} /> Baixar
              </button>
            </div>
          ))}
          {myDocs.length === 0 && <div className="pf-empty">Nenhum documento disponível.</div>}
        </div>
      </Card>
    </div>
  );
}

/* ============================== INVESTOR: PERFIL =============================== */

function InvestorPerfil({ user }) {
  return (
    <div className="pf-page">
      <div className="pf-page-head">
        <h2>Perfil</h2>
        <p>Seus dados cadastrais na PrecForge.</p>
      </div>
      <Card>
        <div className="pf-profile-grid">
          <div><span>Nome</span><strong>{user.nome}</strong></div>
          <div><span>CPF/CNPJ</span><strong>{user.cpfCnpj}</strong></div>
          <div><span>E-mail</span><strong>{user.email}</strong></div>
          <div><span>Telefone</span><strong>{user.telefone}</strong></div>
          <div><span>Cliente desde</span><strong>{formatDateBR(user.createdAt)}</strong></div>
          <div><span>Status da conta</span><strong><Badge status={user.status} /></strong></div>
        </div>
      </Card>
    </div>
  );
}

/* ================================ ADMIN: DASHBOARD ============================== */

const PIE_COLORS = ["#34D399", "#C9762E", "#6E9FE0", "#C9A227", "#B084E3"];

function AdminDashboard({ users, investments }) {
  const now = new Date();
  const investidores = users.filter((u) => u.role === "investidor");
  const ativos = investments.filter((i) => i.status === "Ativo");
  const totalInvestido = investments.reduce((s, i) => s + i.valorInvestido, 0);
  const patrimonioTotal = investments.reduce((s, i) => s + currentValueAt(i, now), 0);
  const rentConsolidada = totalInvestido > 0 ? (patrimonioTotal / totalInvestido - 1) * 100 : 0;

  const [range, setRange] = useState("6m");
  const series = useMemo(() => buildPortfolioSeries(investments, range), [investments, range]);

  const distribuicao = TIPOS_INVESTIMENTO.map((tipo) => ({
    tipo,
    valor: investments.filter((i) => i.tipo === tipo).reduce((s, i) => s + currentValueAt(i, now), 0),
  })).filter((d) => d.valor > 0);

  const porInvestidor = investidores.map((u) => ({
    nome: u.nome.split(" ")[0],
    valor: investments.filter((i) => i.userId === u.id).reduce((s, i) => s + currentValueAt(i, now), 0),
  }));

  return (
    <div className="pf-page">
      <div className="pf-page-head">
        <h2>Visão geral</h2>
        <p>Patrimônio consolidado sob gestão da PrecForge.</p>
      </div>

      <div className="pf-cards-grid pf-cards-grid-5">
        <Card title="Patrimônio total" icon={TrendingUp} accent>
          <div className="pf-metric pf-metric-accent">{formatBRL(patrimonioTotal)}</div>
        </Card>
        <Card title="Total investido" icon={Wallet}>
          <div className="pf-metric">{formatBRL(totalInvestido)}</div>
        </Card>
        <Card title="Investidores ativos" icon={Users}>
          <div className="pf-metric">{investidores.filter((u) => u.status === "Ativo").length}</div>
        </Card>
        <Card title="Investimentos ativos" icon={ClipboardList}>
          <div className="pf-metric">{ativos.length}</div>
        </Card>
        <Card title="Rentabilidade consolidada">
          <div className="pf-metric"><Delta value={rentConsolidada} /></div>
        </Card>
      </div>

      <Card className="pf-chart-card">
        <div className="pf-chart-head">
          <div className="pf-chart-title">Evolução do patrimônio total</div>
          <RangeTabs value={range} onChange={setRange} />
        </div>
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={series} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="pfEmber" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#34D399" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#34D399" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 6" vertical={false} />
            <XAxis dataKey="label" tick={{ fill: "var(--text-faint)", fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={30} />
            <YAxis tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} tick={{ fill: "var(--text-faint)", fontSize: 11 }} axisLine={false} tickLine={false} width={44} />
            <Tooltip content={<ChartTooltip />} />
            <Area type="monotone" dataKey="valor" stroke="#34D399" strokeWidth={2} fill="url(#pfEmber)" />
          </AreaChart>
        </ResponsiveContainer>
      </Card>

      <div className="pf-two-col">
        <Card title="Distribuição por tipo de investimento">
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={distribuicao} dataKey="valor" nameKey="tipo" innerRadius={55} outerRadius={85} paddingAngle={2}>
                {distribuicao.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
              </Pie>
              <Tooltip formatter={(v) => formatBRL(v)} contentStyle={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 8 }} />
            </PieChart>
          </ResponsiveContainer>
          <div className="pf-legend">
            {distribuicao.map((d, i) => (
              <div key={d.tipo} className="pf-legend-item">
                <span className="pf-legend-dot" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                {d.tipo}
              </div>
            ))}
          </div>
        </Card>
        <Card title="Patrimônio por investidor">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={porInvestidor} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 6" vertical={false} />
              <XAxis dataKey="nome" tick={{ fill: "var(--text-faint)", fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} tick={{ fill: "var(--text-faint)", fontSize: 11 }} axisLine={false} tickLine={false} width={44} />
              <Tooltip formatter={(v) => formatBRL(v)} contentStyle={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 8 }} />
              <Bar dataKey="valor" fill="#C9762E" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>
    </div>
  );
}

/* ================================ ADMIN: INVESTIDORES ============================ */

function UserFormModal({ initial, onClose, onSave }) {
  const [form, setForm] = useState(
    initial
      ? { ...initial, dataCadastro: (initial.createdAt || "").slice(0, 10) }
      : { nome: "", cpfCnpj: "", email: "", telefone: "", senha: "demo123", dataCadastro: new Date().toISOString().slice(0, 10) }
  );
  return (
    <Modal title={initial ? "Editar investidor" : "Novo investidor"} onClose={onClose}>
      <form
        className="pf-form"
        onSubmit={(e) => { e.preventDefault(); onSave(form); }}
      >
        <Field label="Nome completo">
          <input required value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
        </Field>
        <Field label="CPF/CNPJ">
          <input required value={form.cpfCnpj} onChange={(e) => setForm({ ...form, cpfCnpj: e.target.value })} />
        </Field>
        <Field label="E-mail">
          <input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} disabled={!!initial} />
        </Field>
        <Field label="Telefone">
          <input required value={form.telefone} onChange={(e) => setForm({ ...form, telefone: e.target.value })} />
        </Field>
        <Field label="Data de cadastro">
          <input required type="date" value={form.dataCadastro} onChange={(e) => setForm({ ...form, dataCadastro: e.target.value })} />
        </Field>
        <button className="pf-btn pf-btn-primary pf-btn-block" type="submit">
          {initial ? "Salvar alterações" : "Criar investidor"}
        </button>
      </form>
    </Modal>
  );
}

function AdminInvestidores({ users, investments, onCreate, onUpdate, onBlock, onActivate, onResetPassword }) {
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);

  const investidores = users
    .filter((u) => u.role === "investidor")
    .filter((u) => `${u.nome} ${u.email} ${u.cpfCnpj}`.toLowerCase().includes(search.toLowerCase()));

  const patrimonioDe = (id) =>
    investments.filter((i) => i.userId === id).reduce((s, i) => s + currentValueAt(i, new Date()), 0);

  return (
    <div className="pf-page">
      <div className="pf-page-head pf-page-head-row">
        <div>
          <h2>Investidores</h2>
          <p>Gerencie as contas de investidores da plataforma.</p>
        </div>
        <button className="pf-btn pf-btn-primary" onClick={() => setCreating(true)}>
          <Plus size={16} /> Novo investidor
        </button>
      </div>

      <Card>
        <div className="pf-table-toolbar">
          <div className="pf-search pf-search-inline">
            <Search size={15} />
            <input placeholder="Buscar por nome, e-mail ou CPF/CNPJ…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="pf-table-wrap">
          <table className="pf-table">
            <thead>
              <tr>
                <th>Nome</th><th>CPF/CNPJ</th><th>E-mail</th><th>Telefone</th>
                <th>Cadastro</th><th>Patrimônio</th><th>Status</th><th></th>
              </tr>
            </thead>
            <tbody>
              {investidores.map((u) => (
                <tr key={u.id}>
                  <td className="pf-cell-strong">{u.nome}</td>
                  <td>{u.cpfCnpj}</td>
                  <td>{u.email}</td>
                  <td>{u.telefone}</td>
                  <td>{formatDateBR(u.createdAt)}</td>
                  <td className="pf-mono">{formatBRL(patrimonioDe(u.id))}</td>
                  <td><Badge status={u.status} /></td>
                  <td>
                    <div className="pf-row-actions">
                      <button className="pf-icon-btn" title="Editar" onClick={() => setEditing(u)}><Pencil size={15} /></button>
                      <button className="pf-icon-btn" title="Redefinir senha" onClick={() => onResetPassword(u)}><KeyRound size={15} /></button>
                      {u.status === "Ativo" ? (
                        <button className="pf-icon-btn pf-icon-btn-danger" title="Bloquear" onClick={() => onBlock(u)}><Ban size={15} /></button>
                      ) : (
                        <button className="pf-icon-btn pf-icon-btn-ok" title="Ativar" onClick={() => onActivate(u)}><Check size={15} /></button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {investidores.length === 0 && (
                <tr><td colSpan={8} className="pf-empty">Nenhum investidor encontrado.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {creating && (
        <UserFormModal onClose={() => setCreating(false)} onSave={(data) => { onCreate(data); setCreating(false); }} />
      )}
      {editing && (
        <UserFormModal initial={editing} onClose={() => setEditing(null)} onSave={(data) => { onUpdate(editing.id, data); setEditing(null); }} />
      )}
    </div>
  );
}

/* ================================ ADMIN: INVESTIMENTOS ============================ */

function InvestmentFormModal({ users, initial, onClose, onSave }) {
  const investidores = users.filter((u) => u.role === "investidor");
  const [form, setForm] = useState(() =>
    initial
      ? {
          userId: initial.userId,
          nome: initial.nome,
          tipo: initial.tipo,
          valorInvestido: String(initial.valorInvestido),
          dataAplicacao: initial.dataAplicacao,
          taxa: String(Number((initial.taxa * 100).toFixed(4))),
          tipoTaxa: initial.tipoTaxa,
          prazoMeses: String(initial.prazoMeses),
          dataVencimento: initial.dataVencimento || "",
          observacoes: initial.observacoes || "",
          status: initial.status,
        }
      : {
          userId: investidores[0]?.id || "",
          nome: "",
          tipo: TIPOS_INVESTIMENTO[0],
          valorInvestido: "",
          dataAplicacao: new Date().toISOString().slice(0, 10),
          taxa: "",
          tipoTaxa: "Prefixada",
          prazoMeses: "",
          dataVencimento: "",
          observacoes: "",
          status: "Ativo",
        }
  );

  function submit(e) {
    e.preventDefault();
    onSave({
      ...form,
      valorInvestido: parseFloat(form.valorInvestido),
      taxa: parseFloat(form.taxa) / 100,
      prazoMeses: parseInt(form.prazoMeses, 10),
    });
  }

  return (
    <Modal title={initial ? `Editar investimento — ${initial.nome}` : "Novo investimento"} onClose={onClose} wide>
      <form className="pf-form pf-form-grid" onSubmit={submit}>
        <Field label="Investidor">
          <select value={form.userId} onChange={(e) => setForm({ ...form, userId: e.target.value })} required>
            {investidores.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
          </select>
        </Field>
        <Field label="Nome do investimento">
          <input required value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="Precatório Federal 003" />
        </Field>
        <Field label="Tipo de ativo">
          <select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}>
            {TIPOS_INVESTIMENTO.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Valor investido (R$)">
          <input required type="number" min="0" step="0.01" value={form.valorInvestido} onChange={(e) => setForm({ ...form, valorInvestido: e.target.value })} placeholder="250000" />
        </Field>
        <Field label="Data da aplicação">
          <input required type="date" value={form.dataAplicacao} onChange={(e) => setForm({ ...form, dataAplicacao: e.target.value })} />
        </Field>
        <Field label="Taxa contratada (% a.a.)">
          <input required type="number" min="0" step="0.01" value={form.taxa} onChange={(e) => setForm({ ...form, taxa: e.target.value })} placeholder="20" />
        </Field>
        <Field label="Tipo de taxa">
          <select value={form.tipoTaxa} onChange={(e) => setForm({ ...form, tipoTaxa: e.target.value })}>
            <option>Prefixada</option>
            <option>Pós-fixada</option>
          </select>
        </Field>
        <Field label="Prazo da operação (meses)">
          <input required type="number" min="1" value={form.prazoMeses} onChange={(e) => setForm({ ...form, prazoMeses: e.target.value })} placeholder="48" />
        </Field>
        <Field label="Data prevista de vencimento">
          <input required type="date" value={form.dataVencimento} onChange={(e) => setForm({ ...form, dataVencimento: e.target.value })} />
        </Field>
        {initial && (
          <Field label="Status">
            <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              <option>Ativo</option>
              <option>Liquidado</option>
              <option>Em análise</option>
              <option>Suspenso</option>
            </select>
          </Field>
        )}
        <Field label="Observações">
          <textarea rows={2} value={form.observacoes} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} />
        </Field>
        <button className="pf-btn pf-btn-primary pf-btn-block pf-form-span" type="submit">
          {initial ? "Salvar alterações" : "Cadastrar investimento"}
        </button>
      </form>
    </Modal>
  );
}

function ConfirmModal({ title, message, confirmLabel, onConfirm, onCancel }) {
  return (
    <Modal title={title} onClose={onCancel}>
      <p className="pf-modal-text">{message}</p>
      <div className="pf-confirm-actions">
        <button className="pf-btn pf-btn-ghost pf-btn-block" onClick={onCancel}>Cancelar</button>
        <button className="pf-btn pf-btn-danger pf-btn-block" onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </Modal>
  );
}

function AdminInvestimentos({ users, investments, onCreate, onUpdate, onDelete, onOpenInvestment }) {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [search, setSearch] = useState("");
  const [filterUser, setFilterUser] = useState("");
  const [filterTipo, setFilterTipo] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [minValue, setMinValue] = useState("");
  const [maxValue, setMaxValue] = useState("");

  const nameOf = (id) => users.find((u) => u.id === id)?.nome || "—";

  const filtered = investments.filter((i) => {
    if (search && !`${i.nome} ${nameOf(i.userId)}`.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterUser && i.userId !== filterUser) return false;
    if (filterTipo && i.tipo !== filterTipo) return false;
    if (filterStatus && i.status !== filterStatus) return false;
    if (minValue && i.valorInvestido < parseFloat(minValue)) return false;
    if (maxValue && i.valorInvestido > parseFloat(maxValue)) return false;
    return true;
  });

  const now = new Date();

  return (
    <div className="pf-page">
      <div className="pf-page-head pf-page-head-row">
        <div>
          <h2>Investimentos</h2>
          <p>Todas as operações cadastradas na plataforma.</p>
        </div>
        <button className="pf-btn pf-btn-primary" onClick={() => setCreating(true)}>
          <Plus size={16} /> Novo Investimento
        </button>
      </div>

      <Card>
        <div className="pf-filters">
          <div className="pf-search pf-search-inline">
            <Search size={15} />
            <input placeholder="Buscar investimento ou investidor…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select value={filterUser} onChange={(e) => setFilterUser(e.target.value)}>
            <option value="">Investidor: todos</option>
            {users.filter((u) => u.role === "investidor").map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
          </select>
          <select value={filterTipo} onChange={(e) => setFilterTipo(e.target.value)}>
            <option value="">Tipo: todos</option>
            {TIPOS_INVESTIMENTO.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
            <option value="">Status: todos</option>
            <option>Ativo</option><option>Liquidado</option><option>Em análise</option><option>Suspenso</option>
          </select>
          <input className="pf-filter-num" type="number" placeholder="Valor mín." value={minValue} onChange={(e) => setMinValue(e.target.value)} />
          <input className="pf-filter-num" type="number" placeholder="Valor máx." value={maxValue} onChange={(e) => setMaxValue(e.target.value)} />
        </div>

        <div className="pf-table-wrap">
          <table className="pf-table">
            <thead>
              <tr>
                <th>Investimento</th><th>Investidor</th><th>Data</th><th>Valor</th>
                <th>Taxa</th><th>Rentab.</th><th>Valor atual</th><th>Status</th><th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((inv) => (
                <tr key={inv.id} className="pf-row-clickable" onClick={() => onOpenInvestment(inv)}>
                  <td className="pf-cell-strong">{inv.nome}</td>
                  <td>{nameOf(inv.userId)}</td>
                  <td>{formatDateBR(inv.dataAplicacao)}</td>
                  <td className="pf-mono">{formatBRL(inv.valorInvestido)}</td>
                  <td className="pf-mono">{formatPercent(inv.taxa * 100, " a.a.")}</td>
                  <td className="pf-mono"><Delta value={accruedPercent(inv, now)} /></td>
                  <td className="pf-mono pf-cell-strong">{formatBRL(currentValueAt(inv, now))}</td>
                  <td><Badge status={inv.status} /></td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <div className="pf-row-actions">
                      <button className="pf-icon-btn" title="Editar" onClick={() => setEditing(inv)}><Pencil size={15} /></button>
                      <button className="pf-icon-btn pf-icon-btn-danger" title="Excluir" onClick={() => setDeleting(inv)}><X size={15} /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && <tr><td colSpan={9} className="pf-empty">Nenhum investimento encontrado.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      {creating && (
        <InvestmentFormModal users={users} onClose={() => setCreating(false)} onSave={(data) => { onCreate(data); setCreating(false); }} />
      )}
      {editing && (
        <InvestmentFormModal
          users={users}
          initial={editing}
          onClose={() => setEditing(null)}
          onSave={(data) => { onUpdate(editing.id, data); setEditing(null); }}
        />
      )}
      {deleting && (
        <ConfirmModal
          title="Excluir investimento"
          message={`Tem certeza que deseja excluir "${deleting.nome}" (${nameOf(deleting.userId)})? Isso também remove as movimentações e documentos ligados a ele. Esta ação não pode ser desfeita.`}
          confirmLabel="Excluir definitivamente"
          onCancel={() => setDeleting(null)}
          onConfirm={() => { onDelete(deleting); setDeleting(null); }}
        />
      )}
    </div>
  );
}

/* ================================ ADMIN: MOVIMENTAÇÕES ============================ */

function AdminMovimentacoes({ transactions, users, investments }) {
  const nameOf = (id) => users.find((u) => u.id === id)?.nome || "—";
  const invNameOf = (id) => investments.find((i) => i.id === id)?.nome || "—";
  const sorted = [...transactions].sort((a, b) => new Date(b.data) - new Date(a.data));
  return (
    <div className="pf-page">
      <div className="pf-page-head">
        <h2>Movimentações</h2>
        <p>Todas as movimentações registradas na plataforma.</p>
      </div>
      <Card>
        <div className="pf-table-wrap">
          <table className="pf-table">
            <thead>
              <tr><th>Data</th><th>Tipo</th><th>Investidor</th><th>Investimento</th><th>Valor</th><th>Descrição</th></tr>
            </thead>
            <tbody>
              {sorted.map((t) => (
                <tr key={t.id}>
                  <td>{formatDateBR(t.data)}</td>
                  <td>{t.tipo}</td>
                  <td>{nameOf(t.userId)}</td>
                  <td>{invNameOf(t.investmentId)}</td>
                  <td className="pf-mono">{t.valor > 0 ? formatBRL(t.valor) : "—"}</td>
                  <td>{t.descricao}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

/* ================================ ADMIN: RELATÓRIOS ============================ */

function AdminRelatorios({ users, investments, addToast }) {
  const now = new Date();

  function exportarExcel(tipo) {
    let rows = [];
    if (tipo === "carteira") {
      rows = investments.map((i) => ({
        Investidor: users.find((u) => u.id === i.userId)?.nome || "",
        Investimento: i.nome,
        Tipo: i.tipo,
        "Valor investido": i.valorInvestido,
        "Data da aplicação": formatDateBR(i.dataAplicacao),
        "Taxa (% a.a.)": (i.taxa * 100).toFixed(2),
        "Prazo (meses)": i.prazoMeses,
        "Rentabilidade acumulada (%)": accruedPercent(i, now).toFixed(2),
        "Valor atual": Number(currentValueAt(i, now).toFixed(2)),
        Status: i.status,
      }));
    } else if (tipo === "investidor") {
      rows = users.filter((u) => u.role === "investidor").map((u) => {
        const inv = investments.filter((i) => i.userId === u.id);
        const total = inv.reduce((s, i) => s + i.valorInvestido, 0);
        const atual = inv.reduce((s, i) => s + currentValueAt(i, now), 0);
        return {
          Investidor: u.nome,
          "E-mail": u.email,
          "Nº de investimentos": inv.length,
          "Total investido": total,
          "Patrimônio atual": Number(atual.toFixed(2)),
          "Rentabilidade (%)": total > 0 ? Number(((atual / total - 1) * 100).toFixed(2)) : 0,
        };
      });
    } else if (tipo === "ativos") {
      rows = investments.filter((i) => i.status === "Ativo").map((i) => ({
        Investimento: i.nome,
        Investidor: users.find((u) => u.id === i.userId)?.nome || "",
        "Valor atual": Number(currentValueAt(i, now).toFixed(2)),
        Vencimento: formatDateBR(i.dataVencimento),
      }));
    } else {
      rows = investments.map((i) => ({
        Investimento: i.nome,
        "Rentabilidade acumulada (%)": accruedPercent(i, now).toFixed(2),
        "Valor investido": i.valorInvestido,
        "Valor atual": Number(currentValueAt(i, now).toFixed(2)),
      }));
    }
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Relatório");
    XLSX.writeFile(wb, `precforge_relatorio_${tipo}.xlsx`);
    addToast("Relatório Excel gerado com sucesso.", "success");
  }

  function exportarPdf(tipo) {
    addToast("Exportação em PDF simulada nesta demonstração — pronta para integração com um serviço de geração de PDF no backend.", "info");
  }

  const relatorios = [
    { key: "investidor", titulo: "Relatório por investidor", desc: "Consolidado de patrimônio e rentabilidade por investidor." },
    { key: "carteira", titulo: "Relatório de carteira", desc: "Detalhamento completo de todos os investimentos cadastrados." },
    { key: "rentabilidade", titulo: "Relatório de rentabilidade", desc: "Rentabilidade acumulada de cada operação." },
    { key: "ativos", titulo: "Relatório de investimentos ativos", desc: "Somente operações com status Ativo." },
  ];

  return (
    <div className="pf-page">
      <div className="pf-page-head">
        <h2>Relatórios</h2>
        <p>Gere relatórios consolidados da operação em Excel ou PDF.</p>
      </div>
      <div className="pf-report-grid">
        {relatorios.map((r) => (
          <Card key={r.key} title={r.titulo} icon={FileSpreadsheet}>
            <p className="pf-report-desc">{r.desc}</p>
            <div className="pf-report-actions">
              <button className="pf-btn pf-btn-ghost pf-btn-sm" onClick={() => exportarExcel(r.key)}>
                <FileSpreadsheet size={14} /> Exportar Excel
              </button>
              <button className="pf-btn pf-btn-ghost pf-btn-sm" onClick={() => exportarPdf(r.key)}>
                <FileDown size={14} /> Exportar PDF
              </button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

/* ================================ ADMIN: LOGS ============================ */

function AdminLogs({ auditLogs, users }) {
  const nameOf = (id) => users.find((u) => u.id === id)?.nome || "—";
  const sorted = [...auditLogs].sort((a, b) => new Date(b.data) - new Date(a.data));
  return (
    <div className="pf-page">
      <div className="pf-page-head">
        <h2>Logs de auditoria</h2>
        <p>Registro de todas as alterações realizadas por administradores.</p>
      </div>
      <Card>
        <div className="pf-table-wrap">
          <table className="pf-table">
            <thead><tr><th>Data</th><th>Administrador</th><th>Ação</th><th>Entidade</th><th>Detalhes</th></tr></thead>
            <tbody>
              {sorted.map((l) => (
                <tr key={l.id}>
                  <td>{formatDateBR(l.data)}</td>
                  <td>{nameOf(l.adminId)}</td>
                  <td>{l.acao}</td>
                  <td className="pf-mono">{l.entidade}</td>
                  <td>{l.detalhes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

/* ================================ ADMIN: CONFIGURAÇÕES ============================ */

function AdminConfiguracoes({ addToast }) {
  const [metodologia, setMetodologia] = useState("dias-corridos");
  const [notifEmail, setNotifEmail] = useState(true);
  const [notifWhats, setNotifWhats] = useState(false);

  return (
    <div className="pf-page">
      <div className="pf-page-head">
        <h2>Configurações</h2>
        <p>Parâmetros gerais de cálculo e integrações da plataforma.</p>
      </div>
      <Card title="Metodologia de cálculo">
        <p className="pf-report-desc">Base utilizada para o cálculo proporcional de rentabilidade entre datas.</p>
        <div className="pf-radio-group">
          <label className="pf-radio">
            <input type="radio" checked={metodologia === "dias-corridos"} onChange={() => setMetodologia("dias-corridos")} />
            Dias corridos (base 365)
          </label>
          <label className="pf-radio">
            <input type="radio" checked={metodologia === "dias-uteis"} onChange={() => setMetodologia("dias-uteis")} />
            Dias úteis (base 252)
          </label>
        </div>
      </Card>
      <Card title="Notificações">
        <label className="pf-switch-row">
          <span>Notificar investidores por e-mail sobre atualizações de carteira</span>
          <input type="checkbox" checked={notifEmail} onChange={(e) => setNotifEmail(e.target.checked)} />
        </label>
        <label className="pf-switch-row">
          <span>Notificar por WhatsApp (integração futura)</span>
          <input type="checkbox" checked={notifWhats} onChange={(e) => setNotifWhats(e.target.checked)} />
        </label>
      </Card>
      <Card title="Integrações preparadas">
        <ul className="pf-integrations">
          <li>Gateway de pagamentos</li>
          <li>Assinatura eletrônica de contratos</li>
          <li>APIs financeiras (índices e indexadores)</li>
          <li>Notificações por e-mail e WhatsApp</li>
          <li>Upload de documentos em nuvem</li>
          <li>Multiempresa</li>
        </ul>
      </Card>
      <button
        className="pf-btn pf-btn-primary"
        onClick={() => addToast("Configurações salvas.", "success")}
      >
        Salvar configurações
      </button>
    </div>
  );
}

/* ===================================== APP ===================================== */

export default function App() {
  const [booting, setBooting] = useState(true);
  const [users, setUsers] = useState([]);
  const [investments, setInvestments] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);

  const [session, setSession] = useState(null);
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [page, setPage] = useState("dashboard");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [openInvestment, setOpenInvestment] = useState(null);
  const [toasts, setToasts] = useState([]);

  function addToast(message, type = "info") {
    const id = genId("toast");
    setToasts((t) => [...t, { id, message, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3600);
  }

  // Busca os dados reais do Supabase. A Row Level Security do banco já
  // garante que um investidor só recebe as próprias linhas — não é
  // necessário filtrar por usuário aqui.
  async function loadAllData() {
    const [profilesRes, investmentsRes, transactionsRes, documentsRes, auditRes] = await Promise.all([
      supabase.from("profiles").select("*"),
      supabase.from("investments").select("*"),
      supabase.from("transactions").select("*"),
      supabase.from("documents").select("*"),
      supabase.from("audit_logs").select("*"),
    ]);
    if (profilesRes.data) setUsers(profilesRes.data.map(mapProfile));
    if (investmentsRes.data) setInvestments(investmentsRes.data.map(mapInvestment));
    if (transactionsRes.data) setTransactions(transactionsRes.data.map(mapTransaction));
    if (documentsRes.data) setDocuments(documentsRes.data.map(mapDocument));
    if (auditRes.data) setAuditLogs(auditRes.data.map(mapAuditLog));
  }

  // Detecta quando a pessoa chega pelo link de e-mail (redefinição de senha
  // ou primeiro acesso). Nesse caso, o Supabase dispara o evento abaixo em
  // vez de simplesmente logar a pessoa direto.
  useEffect(() => {
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setRecoveryMode(true);
        setBooting(false);
      }
    });
    return () => listener?.subscription?.unsubscribe();
  }, []);

  async function finishRecovery() {
    setRecoveryMode(false);
    const { data } = await supabase.auth.getSession();
    const authUser = data?.session?.user;
    if (authUser) {
      const { data: profileRow } = await supabase.from("profiles").select("*").eq("id", authUser.id).single();
      if (profileRow) {
        setSession(mapProfile(profileRow));
        setPage("dashboard");
        await loadAllData();
        addToast("Senha definida com sucesso. Bem-vindo(a)!", "success");
      }
    }
  }

  // Ao carregar a página, verifica se já existe uma sessão válida (usuário
  // continua logado após atualizar a página).
  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      const authUser = data?.session?.user;
      if (authUser) {
        const { data: profileRow } = await supabase.from("profiles").select("*").eq("id", authUser.id).single();
        if (profileRow && profileRow.status !== "Bloqueado") {
          setSession(mapProfile(profileRow));
          await loadAllData();
        } else {
          await supabase.auth.signOut();
        }
      }
      setBooting(false);
    })();
  }, []);

  async function handleLogin(email, senha) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password: senha });
    if (error) {
      const msg = (error.message || "").toLowerCase();
      if (msg.includes("email not confirmed")) {
        throw new Error("Este e-mail ainda não foi confirmado. Confirme o usuário no Supabase (Authentication > Users) antes de entrar.");
      }
      if (msg.includes("invalid login credentials")) {
        throw new Error("E-mail ou senha inválidos.");
      }
      // Mostra o erro original (ex.: problema de conexão com o Supabase,
      // URL/chave erradas) em vez de esconder atrás de uma mensagem genérica.
      throw new Error(`Não foi possível entrar: ${error.message}`);
    }
    const { data: profileRow, error: profileError } = await supabase
      .from("profiles").select("*").eq("id", data.user.id).single();
    if (profileError || !profileRow) throw new Error("Não foi possível carregar seu perfil.");
    if (profileRow.status === "Bloqueado") {
      await supabase.auth.signOut();
      throw new Error("Esta conta está bloqueada. Contate o administrador.");
    }
    const profile = mapProfile(profileRow);
    setSession(profile);
    setPage("dashboard");
    await loadAllData();
    addToast(`Bem-vindo(a), ${profile.nome.split(" ")[0]}.`, "success");
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    setSession(null);
    setUsers([]); setInvestments([]); setTransactions([]); setDocuments([]); setAuditLogs([]);
  }

  async function logAction(acao, entidade, entidadeId, detalhes) {
    const { data, error } = await supabase
      .from("audit_logs")
      .insert({ admin_id: session?.id, acao, entidade, entidade_id: entidadeId, detalhes })
      .select().single();
    if (!error && data) setAuditLogs((l) => [mapAuditLog(data), ...l]);
  }

  // ---- ações administrativas ----
  async function createUser(data) {
    // Cria a conta de login de verdade, usando um cliente Supabase à parte
    // para não substituir a sessão do administrador que está logado agora.
    const senhaProvisoria = "PrecForge#" + Math.random().toString(36).slice(2, 8);
    const { data: signUpData, error } = await supabaseAdminSignup.auth.signUp({
      email: data.email,
      password: senhaProvisoria,
      options: { data: { nome: data.nome } },
    });
    if (error) { addToast(`Erro ao criar investidor: ${error.message}`, "info"); return; }
    const newId = signUpData.user?.id;
    if (newId) {
      await supabase.from("profiles").update({
        cpf_cnpj: data.cpfCnpj,
        telefone: data.telefone,
        created_at: data.dataCadastro,
      }).eq("id", newId);
      await supabase.auth.resetPasswordForEmail(data.email);
    }
    await loadAllData();
    logAction("Criou usuário", "USERS", newId, `${data.nome} cadastrado como investidor.`);
    addToast(`Investidor criado. Um e-mail de definição de senha foi enviado a ${data.email}.`, "success");
  }
  async function updateUser(id, data) {
    await supabase.from("profiles").update({
      nome: data.nome,
      cpf_cnpj: data.cpfCnpj,
      telefone: data.telefone,
      created_at: data.dataCadastro,
    }).eq("id", id);
    setUsers((us) => us.map((u) => (u.id === id ? { ...u, ...data, createdAt: data.dataCadastro } : u)));
    logAction("Editou usuário", "USERS", id, "Dados cadastrais atualizados.");
    addToast("Investidor atualizado.", "success");
  }
  async function updateBankInfo(data) {
    const { error } = await supabase.from("profiles").update({
      banco: data.banco,
      agencia: data.agencia,
      conta: data.conta,
      tipo_conta: data.tipoConta,
      titular: data.titular,
      cpf_titular: data.cpfTitular,
      chave_pix: data.chavePix,
    }).eq("id", session.id);
    if (error) { addToast(`Erro ao salvar dados bancários: ${error.message}`, "info"); return; }
    setSession((s) => ({ ...s, ...data }));
    setUsers((us) => us.map((u) => (u.id === session.id ? { ...u, ...data } : u)));
    addToast("Dados bancários salvos com sucesso.", "success");
  }
  async function blockUser(u) {
    await supabase.from("profiles").update({ status: "Bloqueado" }).eq("id", u.id);
    setUsers((us) => us.map((x) => (x.id === u.id ? { ...x, status: "Bloqueado" } : x)));
    logAction("Bloqueou usuário", "USERS", u.id, `${u.nome} bloqueado.`);
    addToast(`${u.nome} foi bloqueado.`, "info");
  }
  async function activateUser(u) {
    await supabase.from("profiles").update({ status: "Ativo" }).eq("id", u.id);
    setUsers((us) => us.map((x) => (x.id === u.id ? { ...x, status: "Ativo" } : x)));
    logAction("Ativou usuário", "USERS", u.id, `${u.nome} ativado.`);
    addToast(`${u.nome} foi ativado.`, "success");
  }
  async function resetPassword(u) {
    await supabase.auth.resetPasswordForEmail(u.email);
    logAction("Solicitou redefinição de senha", "USERS", u.id, `E-mail de redefinição enviado para ${u.nome}.`);
    addToast(`E-mail de redefinição de senha enviado para ${u.email}.`, "success");
  }
  async function createInvestment(data) {
    const { data: invRow, error } = await supabase.from("investments").insert({
      user_id: data.userId,
      nome: data.nome,
      tipo: data.tipo,
      valor_investido: data.valorInvestido,
      data_aplicacao: data.dataAplicacao,
      taxa: data.taxa,
      tipo_taxa: data.tipoTaxa,
      prazo_meses: data.prazoMeses,
      data_vencimento: data.dataVencimento,
      status: "Ativo",
      observacoes: data.observacoes,
    }).select().single();
    if (error) { addToast(`Erro ao cadastrar investimento: ${error.message}`, "info"); return; }
    const inv = mapInvestment(invRow);
    setInvestments((is) => [...is, inv]);
    const { data: txRow } = await supabase.from("transactions").insert({
      investment_id: inv.id, user_id: inv.userId, tipo: "Aplicação realizada",
      valor: inv.valorInvestido, data: inv.dataAplicacao, descricao: `Aplicação inicial em ${inv.nome}.`,
    }).select().single();
    if (txRow) setTransactions((ts) => [mapTransaction(txRow), ...ts]);
    logAction("Cadastrou investimento", "INVESTMENTS", inv.id, `${inv.nome} — ${formatBRL(inv.valorInvestido)} a ${formatPercent(inv.taxa * 100, " a.a.")}`);
    addToast("Investimento cadastrado com sucesso.", "success");
  }
  async function updateInvestment(id, data) {
    const { error } = await supabase.from("investments").update({
      user_id: data.userId,
      nome: data.nome,
      tipo: data.tipo,
      valor_investido: data.valorInvestido,
      data_aplicacao: data.dataAplicacao,
      taxa: data.taxa,
      tipo_taxa: data.tipoTaxa,
      prazo_meses: data.prazoMeses,
      data_vencimento: data.dataVencimento,
      status: data.status,
      observacoes: data.observacoes,
    }).eq("id", id);
    if (error) { addToast(`Erro ao atualizar investimento: ${error.message}`, "info"); return; }
    setInvestments((is) => is.map((i) => (i.id === id ? { ...i, ...data } : i)));
    logAction("Editou investimento", "INVESTMENTS", id, `${data.nome} — dados atualizados (taxa ${formatPercent(data.taxa * 100, " a.a.")}, vencimento ${formatDateBR(data.dataVencimento)}).`);
    addToast("Investimento atualizado com sucesso.", "success");
  }
  async function deleteInvestment(inv) {
    const { error } = await supabase.from("investments").delete().eq("id", inv.id);
    if (error) { addToast(`Erro ao excluir investimento: ${error.message}`, "info"); return; }
    setInvestments((is) => is.filter((i) => i.id !== inv.id));
    setTransactions((ts) => ts.filter((t) => t.investmentId !== inv.id));
    setDocuments((ds) => ds.filter((d) => d.investmentId !== inv.id));
    logAction("Excluiu investimento", "INVESTMENTS", inv.id, `${inv.nome} (${formatBRL(inv.valorInvestido)}) removido da plataforma.`);
    addToast("Investimento excluído.", "success");
  }

  if (recoveryMode) return <div className="pf-app"><GlobalStyle /><SetNewPasswordScreen onDone={finishRecovery} /></div>;
  if (booting) return <div className="pf-app"><GlobalStyle /><LoadingScreen /></div>;
  if (!session) return <div className="pf-app"><GlobalStyle /><LoginScreen onLogin={handleLogin} /></div>;

  const isMaster = session.role === "master";
  const navItems = isMaster ? NAV_ADMIN : NAV_INVESTOR;
  const pageTitle = navItems.find((n) => n.key === page)?.label || "";

  return (
    <div className="pf-app">
      <GlobalStyle />
      <div className="pf-shell">
        <Sidebar role={session.role} page={page} setPage={setPage} onLogout={handleLogout} open={drawerOpen} setOpen={setDrawerOpen} />
        <div className="pf-main">
          <Topbar user={session} title={pageTitle} onMenu={() => setDrawerOpen(true)} />
          <div className="pf-content">
            {!isMaster && page === "dashboard" && (
              <InvestorDashboard user={session} investments={investments} onOpenInvestment={setOpenInvestment} />
            )}
            {!isMaster && page === "carteira" && (
              <InvestorCarteira user={session} investments={investments} onOpenInvestment={setOpenInvestment} onSaveBankInfo={updateBankInfo} />
            )}
            {!isMaster && page === "historico" && (
              <InvestorHistorico user={session} transactions={transactions} investments={investments} />
            )}
            {!isMaster && page === "documentos" && (
              <InvestorDocumentos user={session} documents={documents} investments={investments} addToast={addToast} />
            )}
            {!isMaster && page === "perfil" && <InvestorPerfil user={session} />}

            {isMaster && page === "dashboard" && <AdminDashboard users={users} investments={investments} />}
            {isMaster && page === "investidores" && (
              <AdminInvestidores
                users={users}
                investments={investments}
                onCreate={createUser}
                onUpdate={updateUser}
                onBlock={blockUser}
                onActivate={activateUser}
                onResetPassword={resetPassword}
              />
            )}
            {isMaster && page === "investimentos" && (
              <AdminInvestimentos users={users} investments={investments} onCreate={createInvestment} onUpdate={updateInvestment} onDelete={deleteInvestment} onOpenInvestment={setOpenInvestment} />
            )}
            {isMaster && page === "movimentacoes" && (
              <AdminMovimentacoes transactions={transactions} users={users} investments={investments} />
            )}
            {isMaster && page === "relatorios" && (
              <AdminRelatorios users={users} investments={investments} addToast={addToast} />
            )}
            {isMaster && page === "logs" && <AdminLogs auditLogs={auditLogs} users={users} />}
            {isMaster && page === "configuracoes" && <AdminConfiguracoes addToast={addToast} />}
          </div>
        </div>
      </div>

      {openInvestment && <InvestmentDetailModal investment={openInvestment} onClose={() => setOpenInvestment(null)} />}
      <ToastStack toasts={toasts} />
    </div>
  );
}

/* ==================================== ESTILOS ==================================== */

function GlobalStyle() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');

      :root {
        --bg: #0a0d0b;
        --surface: #101410;
        --surface-2: #161b16;
        --surface-3: #1c221c;
        --border: #232a23;
        --text: #eaece7;
        --text-dim: #9aa39a;
        --text-faint: #626b62;
        --green: #34d399;
        --green-dim: rgba(52,211,153,0.12);
        --ember: #c9762e;
        --ember-dim: rgba(201,118,46,0.14);
        --red: #e5484d;
        --red-dim: rgba(229,72,77,0.12);
        --blue: #6e9fe0;
        --font-display: 'Fraunces', serif;
        --font-body: 'Inter', -apple-system, sans-serif;
        --font-mono: 'JetBrains Mono', monospace;
      }
      * { box-sizing: border-box; }
      .pf-app, .pf-app * { font-family: var(--font-body); }
      .pf-app {
        background: var(--bg);
        color: var(--text);
        min-height: 100vh;
        width: 100%;
      }
      .pf-demo-ribbon {
        background: var(--ember-dim);
        color: var(--ember);
        text-align: center;
        font-size: 12px;
        padding: 6px 12px;
        border-bottom: 1px solid var(--border);
        letter-spacing: 0.02em;
      }
      button { cursor: pointer; font-family: var(--font-body); }
      input, select, textarea { font-family: var(--font-body); }

      /* ---------- Loading ---------- */
      .pf-loading {
        min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center;
        background: var(--bg); gap: 16px;
      }
      .pf-flame-path { animation: pfFlicker 1.8s ease-in-out infinite; }
      @keyframes pfFlicker { 0%,100% { opacity: 1; } 50% { opacity: 0.55; } }
      .pf-loading-word { font-family: var(--font-display); font-size: 26px; letter-spacing: 0.02em; }
      .pf-loading-bar { width: 180px; height: 2px; background: var(--border); border-radius: 2px; overflow: hidden; }
      .pf-loading-bar-fill { height: 100%; width: 40%; background: var(--ember); animation: pfLoad 1.2s ease-in-out infinite; }
      @keyframes pfLoad { 0% { transform: translateX(-100%);} 100% { transform: translateX(350%);} }
      .pf-loading-caption { color: var(--text-faint); font-size: 13px; }

      /* ---------- Brand ---------- */
      .pf-brand { display: flex; align-items: center; gap: 10px; font-family: var(--font-display); font-size: 19px; font-weight: 600; letter-spacing: 0.01em; }
      .pf-brand-mobile { display: none; margin-bottom: 18px; }

      /* ---------- Login ---------- */
      .pf-login { min-height: 100vh; display: flex; background: var(--bg); }
      .pf-login-side { flex: 1.1; background: linear-gradient(160deg, #0d120d 0%, #0a0d0b 65%); border-right: 1px solid var(--border); display: flex; align-items: center; padding: 60px; position: relative; overflow: hidden; }
      .pf-login-side::before { content: ''; position: absolute; inset: 0; background: radial-gradient(circle at 20% 20%, rgba(201,118,46,0.08), transparent 45%); }
      .pf-login-side-inner { max-width: 420px; position: relative; }
      .pf-login-side-inner h1 { font-family: var(--font-display); font-size: 34px; line-height: 1.25; margin: 28px 0 14px; font-weight: 600; }
      .pf-login-side-inner p { color: var(--text-dim); line-height: 1.6; font-size: 15px; }
      .pf-login-stats { margin-top: 36px; display: flex; flex-direction: column; gap: 14px; }
      .pf-login-stats div { display: flex; align-items: center; gap: 10px; color: var(--text-dim); font-size: 13.5px; }
      .pf-login-stats svg { color: var(--ember); flex-shrink: 0; }
      .pf-login-form-wrap { flex: 1; display: flex; align-items: center; justify-content: center; padding: 40px; }
      .pf-login-form { width: 100%; max-width: 360px; }
      .pf-login-form h2 { font-family: var(--font-display); font-size: 24px; margin: 0 0 6px; }
      .pf-login-sub { color: var(--text-dim); font-size: 13.5px; margin: 0 0 24px; }
      .pf-login-demo { margin-top: 28px; padding-top: 20px; border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: 10px; }
      .pf-login-demo > span:first-child { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-faint); }
      .pf-login-demo-btns { display: flex; gap: 8px; }
      .pf-login-demo-btns .pf-btn { flex: 1; }
      .pf-hint { font-size: 12px; color: var(--text-faint); }

      /* ---------- Fields / inputs ---------- */
      .pf-field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 16px; }
      .pf-field span { font-size: 12.5px; color: var(--text-dim); font-weight: 500; }
      .pf-field input, .pf-field select, .pf-field textarea {
        background: var(--surface-2); border: 1px solid var(--border); color: var(--text);
        border-radius: 8px; padding: 10px 12px; font-size: 14px; outline: none; transition: border-color 0.15s;
        width: 100%;
      }
      .pf-field input:focus, .pf-field select:focus, .pf-field textarea:focus { border-color: var(--green); }
      .pf-input-with-icon { position: relative; display: flex; align-items: center; }
      .pf-input-with-icon input { padding-right: 38px; }
      .pf-input-with-icon .pf-icon-btn { position: absolute; right: 4px; }

      .pf-error { display: flex; align-items: center; gap: 6px; color: var(--red); font-size: 13px; background: var(--red-dim); border: 1px solid rgba(229,72,77,0.3); padding: 8px 10px; border-radius: 8px; margin-bottom: 14px; }

      /* ---------- Buttons ---------- */
      .pf-btn { display: inline-flex; align-items: center; justify-content: center; gap: 7px; border: 1px solid transparent; border-radius: 8px; padding: 10px 16px; font-size: 13.5px; font-weight: 600; transition: all 0.15s; }
      .pf-btn-primary { background: var(--green); color: #05130c; }
      .pf-btn-primary:hover { filter: brightness(1.08); }
      .pf-btn-ghost { background: var(--surface-2); border-color: var(--border); color: var(--text); }
      .pf-btn-ghost:hover { border-color: var(--text-faint); }
      .pf-btn-danger { background: var(--red); color: #fff; }
      .pf-btn-danger:hover { filter: brightness(1.1); }
      .pf-confirm-actions { display: flex; gap: 10px; margin-top: 4px; }
      .pf-btn-block { width: 100%; }
      .pf-btn-sm { padding: 7px 11px; font-size: 12.5px; }
      .pf-link { background: none; border: none; color: var(--text-dim); font-size: 13px; margin-top: 12px; text-decoration: underline; text-underline-offset: 3px; }
      .pf-icon-btn { background: transparent; border: none; color: var(--text-dim); padding: 6px; border-radius: 6px; display: inline-flex; }
      .pf-icon-btn:hover { background: var(--surface-3); color: var(--text); }
      .pf-icon-btn-danger:hover { color: var(--red); }
      .pf-icon-btn-ok:hover { color: var(--green); }
      .pf-only-mobile { display: none; }

      /* ---------- Shell ---------- */
      .pf-shell { display: flex; min-height: calc(100vh - 30px); }
      .pf-sidebar { width: 232px; background: var(--surface); border-right: 1px solid var(--border); display: flex; flex-direction: column; padding: 20px 14px; flex-shrink: 0; }
      .pf-sidebar-brand { padding: 4px 8px 22px; }
      .pf-nav { display: flex; flex-direction: column; gap: 2px; flex: 1; }
      .pf-nav-item { display: flex; align-items: center; gap: 11px; background: none; border: none; color: var(--text-dim); padding: 10px 12px; border-radius: 8px; font-size: 13.8px; text-align: left; position: relative; }
      .pf-nav-item:hover { background: var(--surface-2); color: var(--text); }
      .pf-nav-item-active { background: var(--green-dim); color: var(--green); }
      .pf-nav-active-dot { margin-left: auto; width: 5px; height: 5px; border-radius: 50%; background: var(--green); }
      .pf-nav-item-logout { color: var(--text-faint); margin-top: 10px; border-top: 1px solid var(--border); padding-top: 14px; }
      .pf-nav-item-logout:hover { color: var(--red); background: none; }
      .pf-drawer-scrim { display: none; }

      .pf-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
      .pf-topbar { height: 64px; border-bottom: 1px solid var(--border); display: flex; align-items: center; padding: 0 28px; gap: 16px; flex-shrink: 0; }
      .pf-topbar h1 { font-family: var(--font-display); font-size: 18px; font-weight: 600; margin: 0; }
      .pf-topbar-right { margin-left: auto; display: flex; align-items: center; gap: 10px; }
      .pf-avatar { width: 32px; height: 32px; border-radius: 50%; background: var(--surface-3); border: 1px solid var(--border); display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 600; color: var(--text-dim); }
      .pf-search { display: flex; align-items: center; gap: 8px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; padding: 7px 12px; color: var(--text-faint); }
      .pf-search input { background: none; border: none; outline: none; color: var(--text); font-size: 13px; width: 180px; }
      .pf-search-inline { margin-bottom: 0; }

      .pf-content { padding: 26px 28px 60px; overflow-y: auto; }
      .pf-page { display: flex; flex-direction: column; gap: 20px; max-width: 1180px; }
      .pf-page-head h2 { font-family: var(--font-display); font-size: 22px; margin: 0 0 4px; }
      .pf-page-head p { color: var(--text-dim); font-size: 13.5px; margin: 0; }
      .pf-page-head-row { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
      .pf-greeting h2 { font-family: var(--font-display); font-size: 26px; margin: 0 0 4px; }
      .pf-greeting p { color: var(--text-dim); font-size: 13.5px; margin: 0; }

      /* ---------- Cards ---------- */
      .pf-cards-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
      .pf-cards-grid-5 { grid-template-columns: repeat(5, 1fr); }
      .pf-card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 18px 20px; }
      .pf-card-head { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--text-dim); font-weight: 500; margin-bottom: 10px; }
      .pf-card-icon { color: var(--text-faint); }
      .pf-metric { font-family: var(--font-mono); font-size: 24px; font-weight: 600; letter-spacing: -0.01em; }
      .pf-metric-accent { color: var(--green); }
      .pf-metric-sub { display: block; margin-top: 6px; font-size: 12px; color: var(--text-faint); }
      .pf-text-accent { color: var(--green); }

      .pf-delta { display: inline-flex; align-items: center; gap: 3px; font-family: var(--font-mono); font-weight: 600; font-size: 13.5px; }
      .pf-delta-up { color: var(--green); }
      .pf-delta-down { color: var(--red); }

      .pf-chart-card { padding: 20px 22px 8px; }
      .pf-chart-head { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 6px; flex-wrap: wrap; gap: 12px; }
      .pf-chart-title { font-size: 13px; color: var(--text-dim); margin-bottom: 4px; }
      .pf-chart-value { font-family: var(--font-mono); font-size: 22px; font-weight: 600; }
      .pf-range-tabs { display: flex; gap: 2px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; padding: 3px; }
      .pf-range-tab { background: none; border: none; color: var(--text-faint); font-size: 12px; font-weight: 600; padding: 5px 10px; border-radius: 6px; }
      .pf-range-tab-active { background: var(--surface-3); color: var(--text); }

      .pf-tooltip { background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; padding: 8px 12px; }
      .pf-tooltip-label { font-size: 11px; color: var(--text-faint); margin-bottom: 2px; }
      .pf-tooltip-value { font-family: var(--font-mono); font-size: 13px; font-weight: 600; }

      .pf-two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
      .pf-legend { display: flex; flex-wrap: wrap; gap: 10px 16px; margin-top: 8px; justify-content: center; }
      .pf-legend-item { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-dim); }
      .pf-legend-dot { width: 8px; height: 8px; border-radius: 50%; }

      /* ---------- Mini list (dashboard) ---------- */
      .pf-mini-list { display: flex; flex-direction: column; gap: 2px; }
      .pf-mini-row { display: flex; align-items: center; gap: 14px; background: none; border: none; border-top: 1px solid var(--border); padding: 13px 4px; width: 100%; text-align: left; color: var(--text); }
      .pf-mini-row:first-child { border-top: none; }
      .pf-mini-row:hover { background: var(--surface-2); border-radius: 8px; }
      .pf-mini-row-main { flex: 1; min-width: 0; }
      .pf-mini-row-name { font-size: 13.5px; font-weight: 600; }
      .pf-mini-row-sub { font-size: 12px; color: var(--text-faint); margin-top: 2px; }
      .pf-mini-row-value { text-align: right; font-family: var(--font-mono); font-size: 13.5px; font-weight: 600; }
      .pf-mini-row-chevron { color: var(--text-faint); flex-shrink: 0; }

      /* ---------- Tables ---------- */
      .pf-table-wrap { overflow-x: auto; }
      .pf-table { width: 100%; border-collapse: collapse; font-size: 13px; }
      .pf-table th { text-align: left; color: var(--text-faint); font-weight: 500; font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.04em; padding: 10px 12px; border-bottom: 1px solid var(--border); white-space: nowrap; }
      .pf-table td { padding: 12px; border-bottom: 1px solid var(--border); white-space: nowrap; }
      .pf-table tbody tr:last-child td { border-bottom: none; }
      .pf-row-clickable { cursor: pointer; }
      .pf-row-clickable:hover { background: var(--surface-2); }
      .pf-cell-strong { font-weight: 600; }
      .pf-mono { font-family: var(--font-mono); }
      .pf-empty { text-align: center; color: var(--text-faint); padding: 30px 0 !important; white-space: normal; }

      .pf-badge { display: inline-flex; align-items: center; padding: 3px 9px; border-radius: 20px; font-size: 11.5px; font-weight: 600; border: 1px solid transparent; }
      .pf-badge-green { background: var(--green-dim); color: var(--green); border-color: rgba(52,211,153,0.25); }
      .pf-badge-red { background: var(--red-dim); color: var(--red); border-color: rgba(229,72,77,0.25); }
      .pf-badge-amber { background: rgba(201,162,39,0.12); color: #c9a227; border-color: rgba(201,162,39,0.25); }
      .pf-badge-blue { background: rgba(110,159,224,0.12); color: var(--blue); border-color: rgba(110,159,224,0.25); }
      .pf-badge-neutral { background: var(--surface-3); color: var(--text-dim); }

      .pf-row-actions { display: flex; gap: 2px; }

      /* ---------- Table toolbar / filters ---------- */
      .pf-table-toolbar { margin-bottom: 14px; }
      .pf-filters { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 16px; }
      .pf-filters select, .pf-filter-num { background: var(--surface-2); border: 1px solid var(--border); color: var(--text); border-radius: 8px; padding: 8px 10px; font-size: 12.5px; outline: none; }
      .pf-filter-num { width: 110px; }

      /* ---------- Modal ---------- */
      .pf-modal-overlay { position: fixed; inset: 0; background: rgba(5,8,6,0.7); backdrop-filter: blur(2px); display: flex; align-items: center; justify-content: center; z-index: 100; padding: 20px; }
      .pf-modal { background: var(--surface); border: 1px solid var(--border); border-radius: 14px; width: 100%; max-width: 440px; max-height: 88vh; display: flex; flex-direction: column; }
      .pf-modal-wide { max-width: 760px; }
      .pf-modal-head { display: flex; align-items: center; justify-content: space-between; padding: 18px 22px; border-bottom: 1px solid var(--border); }
      .pf-modal-head h3 { font-family: var(--font-display); font-size: 17px; margin: 0; font-weight: 600; }
      .pf-modal-body { padding: 20px 22px 24px; overflow-y: auto; }
      .pf-modal-text { color: var(--text-dim); font-size: 13.5px; line-height: 1.6; margin-bottom: 18px; }

      .pf-form { display: flex; flex-direction: column; }
      .pf-form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 14px; }
      .pf-form-span { grid-column: 1 / -1; }

      /* ---------- Investment detail ---------- */
      .pf-detail-grid { display: grid; grid-template-columns: 1fr 1.2fr; gap: 26px; }
      .pf-detail-facts { display: flex; flex-direction: column; gap: 12px; }
      .pf-detail-facts > div { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding-bottom: 10px; border-bottom: 1px solid var(--border); }
      .pf-detail-facts > div span { color: var(--text-faint); font-size: 12.5px; }
      .pf-detail-facts > div strong { font-size: 13.5px; font-family: var(--font-mono); font-weight: 600; }
      .pf-detail-obs { flex-direction: column !important; align-items: flex-start !important; }
      .pf-detail-obs p { margin: 6px 0 0; font-size: 13px; color: var(--text-dim); font-family: var(--font-body); line-height: 1.5; }
      .pf-detail-chart { display: flex; flex-direction: column; gap: 12px; }

      /* ---------- Timeline ---------- */
      .pf-timeline { display: flex; flex-direction: column; }
      .pf-timeline-item { display: flex; gap: 14px; padding: 4px 0 20px; position: relative; }
      .pf-timeline-item:not(:last-child)::before { content: ''; position: absolute; left: 4px; top: 14px; bottom: 0; width: 1px; background: var(--border); }
      .pf-timeline-dot { width: 9px; height: 9px; border-radius: 50%; background: var(--green); margin-top: 4px; flex-shrink: 0; }
      .pf-timeline-top { display: flex; justify-content: space-between; gap: 10px; font-size: 13.5px; }
      .pf-timeline-top span { color: var(--text-faint); font-size: 12px; }
      .pf-timeline-desc { font-size: 13px; color: var(--text-dim); margin-top: 3px; }
      .pf-timeline-meta { font-size: 12px; color: var(--text-faint); margin-top: 4px; font-family: var(--font-mono); }

      /* ---------- Documents ---------- */
      .pf-doc-list { display: flex; flex-direction: column; }
      .pf-doc-row { display: flex; align-items: center; gap: 12px; padding: 13px 4px; border-top: 1px solid var(--border); }
      .pf-doc-row:first-child { border-top: none; }
      .pf-doc-icon { color: var(--ember); flex-shrink: 0; }
      .pf-doc-info { flex: 1; min-width: 0; }
      .pf-doc-name { font-size: 13.5px; font-weight: 600; }
      .pf-doc-meta { font-size: 12px; color: var(--text-faint); margin-top: 2px; }

      /* ---------- Profile ---------- */
      .pf-profile-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
      .pf-profile-grid > div { display: flex; flex-direction: column; gap: 4px; }
      .pf-profile-grid span { font-size: 12px; color: var(--text-faint); }
      .pf-profile-grid strong { font-size: 14px; }

      /* ---------- Reports ---------- */
      .pf-report-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; }
      .pf-report-desc { font-size: 12.5px; color: var(--text-dim); margin: 0 0 14px; line-height: 1.5; }
      .pf-report-actions { display: flex; gap: 8px; }

      /* ---------- Config ---------- */
      .pf-radio-group { display: flex; flex-direction: column; gap: 10px; }
      .pf-radio { display: flex; align-items: center; gap: 8px; font-size: 13.5px; color: var(--text-dim); }
      .pf-switch-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 0; border-top: 1px solid var(--border); font-size: 13.5px; color: var(--text-dim); }
      .pf-switch-row:first-child { border-top: none; }
      .pf-integrations { margin: 0; padding-left: 18px; color: var(--text-dim); font-size: 13px; line-height: 2; }

      /* ---------- Toasts ---------- */
      .pf-toast-stack { position: fixed; bottom: 20px; right: 20px; display: flex; flex-direction: column; gap: 8px; z-index: 200; }
      .pf-toast { display: flex; align-items: center; gap: 8px; background: var(--surface-2); border: 1px solid var(--border); padding: 11px 16px; border-radius: 10px; font-size: 13px; max-width: 320px; box-shadow: 0 8px 24px rgba(0,0,0,0.4); animation: pfToastIn 0.2s ease-out; }
      .pf-toast-success { border-color: rgba(52,211,153,0.3); color: var(--green); }
      .pf-toast-info { color: var(--text); }
      @keyframes pfToastIn { from { opacity: 0; transform: translateY(6px);} to { opacity: 1; transform: translateY(0);} }

      /* ---------- Responsive ---------- */
      @media (max-width: 980px) {
        .pf-cards-grid { grid-template-columns: repeat(2, 1fr); }
        .pf-cards-grid-5 { grid-template-columns: repeat(2, 1fr); }
        .pf-two-col { grid-template-columns: 1fr; }
        .pf-report-grid { grid-template-columns: 1fr; }
        .pf-detail-grid { grid-template-columns: 1fr; }
        .pf-login-side { display: none; }
      }
      @media (max-width: 760px) {
        .pf-only-mobile { display: inline-flex; }
        .pf-brand-mobile { display: flex; }
        .pf-sidebar { position: fixed; top: 0; left: 0; bottom: 0; z-index: 90; transform: translateX(-100%); transition: transform 0.2s; box-shadow: 20px 0 40px rgba(0,0,0,0.4); }
        .pf-sidebar-open { transform: translateX(0); }
        .pf-drawer-scrim { display: block; position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 80; }
        .pf-content { padding: 18px 16px 50px; }
        .pf-topbar { padding: 0 16px; }
        .pf-search { display: none; }
        .pf-cards-grid { grid-template-columns: 1fr; }
        .pf-cards-grid-5 { grid-template-columns: 1fr; }
        .pf-form-grid { grid-template-columns: 1fr; }
      }
    `}</style>
  );
}
