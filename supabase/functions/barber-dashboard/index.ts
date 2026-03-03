// Barber Web Dashboard — Supabase Edge Function
// GET  → serves the HTML dashboard page
// POST → API actions (get_profile, connect_stripe, update_profile)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/* Raw Stripe helpers (no SDK needed) */
async function stripePost(key: string, path: string, params: Record<string, string>) {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params).toString(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message ?? "Stripe error");
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const SUPABASE_URL      = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SERVICE_ROLE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const STRIPE_KEY        = Deno.env.get("STRIPE_SECRET_KEY")!;

  /* GET: Browser navigation for Stripe Connect (avoids CORS/fetch issues) */
  if (req.method === "GET") {
    const url = new URL(req.url);
    const action = url.searchParams.get("action");

    if (action === "connect_stripe") {
      const token = url.searchParams.get("token");
      const returnUrl = url.searchParams.get("return_url") ?? url.origin;

      if (!token) {
        return new Response("Missing token", { status: 400 });
      }

      // Verify token
      const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      const { data: { user }, error: authErr } = await anonClient.auth.getUser();
      if (authErr || !user) {
        return new Response("Unauthorized", { status: 401 });
      }

      if (!STRIPE_KEY) {
        return new Response("Stripe not configured", { status: 500 });
      }

      try {
        const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
        const { data: profile } = await admin
          .from("profiles")
          .select("stripe_account_id, stripe_onboarding_complete, stripe_charges_enabled")
          .eq("id", user.id)
          .single();

        let accountId: string = (profile as any)?.stripe_account_id ?? "";

        // Already connected → redirect to Stripe Express dashboard
        if ((profile as any)?.stripe_charges_enabled && accountId) {
          const loginLink = await stripePost(STRIPE_KEY, `/accounts/${accountId}/login_links`, {});
          return Response.redirect(loginLink.url, 302);
        }

        // Create account if none
        if (!accountId) {
          const account = await stripePost(STRIPE_KEY, "/accounts", {
            type: "express",
            "capabilities[card_payments][requested]": "true",
            "capabilities[transfers][requested]": "true",
            ...(user.email ? { email: user.email } : {}),
          });
          accountId = account.id;
          await admin.from("profiles").update({ stripe_account_id: accountId }).eq("id", user.id);
        }

        // Allow https:// (production) and http://localhost (local dev). Fallback to success page.
        const isValidReturn = returnUrl.startsWith("https://") ||
          returnUrl.startsWith("http://localhost") ||
          returnUrl.startsWith("http://127.0.0.1");
        const safeReturn = isValidReturn
          ? returnUrl
          : `https://vatghiynlsbpcdxqrfcq.supabase.co/functions/v1/barber-dashboard?stripe_return=1`;

        const accountLink = await stripePost(STRIPE_KEY, "/account_links", {
          account:     accountId,
          return_url:  safeReturn,
          refresh_url: safeReturn,
          type:        "account_onboarding",
        });

        return Response.redirect(accountLink.url, 302);
      } catch (err: any) {
        const msg = err?.message ?? "Unknown error";
        console.error("Stripe Connect error:", msg);
        return new Response(
          `<html><body style="font-family:sans-serif;padding:40px;background:#09090b;color:#fafafa">
            <h2 style="color:#ef4444">Stripe Connect Error</h2>
            <p style="color:#a1a1aa">${msg}</p>
            <a href="${returnUrl}" style="color:#a855f7">← Go back</a>
          </body></html>`,
          { status: 500, headers: { "Content-Type": "text/html" } }
        );
      }
    }

    // stripe_return=1 → show a nice "Connected!" page
    if (url.searchParams.get("stripe_return") === "1") {
      return new Response(
        `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Stripe Connected</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#09090b;color:#fafafa;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px;text-align:center}
.wrap{max-width:400px}.icon{font-size:56px;margin-bottom:20px}.title{font-size:26px;font-weight:900;letter-spacing:-.5px;margin-bottom:10px}.sub{color:#71717a;font-size:15px;line-height:1.6;margin-bottom:28px}
.btn{display:inline-block;background:#a855f7;color:#fff;font-size:15px;font-weight:700;padding:14px 32px;border-radius:14px;text-decoration:none;cursor:pointer}
</style></head><body><div class="wrap"><div class="icon">✅</div><h1 class="title">Stripe Connected!</h1>
<p class="sub">Your payment account is set up.<br>You can now accept online and in-person payments.</p>
<a class="btn" onclick="window.close();history.back()">← Back to Kutz</a></div></body></html>`,
        { headers: { "Content-Type": "text/html; charset=utf-8", "Access-Control-Allow-Origin": "*" } }
      );
    }

    // GET without connect_stripe action → serve HTML dashboard
    const html = buildHTML(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!);
    return new Response(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  /* POST: API calls from the browser */
  if (req.method === "POST") {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "No auth header" }, 401);
    }

    // Verify the user's JWT
    const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await anonClient.auth.getUser();
    if (authErr || !user) {
      return json({ error: "Unauthorized" }, 401);
    }

    // Service role client for DB writes (bypasses RLS)
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    let body: any = {};
    try { body = await req.json(); } catch {}
    const action = body.action;

    /* get_profile */
    if (action === "get_profile") {
      const [profileRes, clientRes, todayRes, revenueRes] = await Promise.all([
        admin.from("profiles").select("*").eq("id", user.id).single(),
        admin.from("clients").select("id", { count: "exact", head: true }).eq("barber_id", user.id),
        admin.from("appointments").select("id", { count: "exact", head: true })
          .eq("barber_id", user.id).eq("date", new Date().toISOString().split("T")[0]),
        admin.from("payments").select("amount_cents").eq("barber_id", user.id).eq("status", "succeeded"),
      ]);

      const totalRevenue = ((revenueRes.data as any[]) ?? [])
        .reduce((s: number, p: any) => s + (p.amount_cents ?? 0), 0);

      return json({
        profile: profileRes.data ?? {},
        stats: {
          totalClients: (clientRes as any).count ?? 0,
          todayAppointments: (todayRes as any).count ?? 0,
          totalRevenue,
        },
        user: { email: user.email, name: user.user_metadata?.full_name ?? "" },
      });
    }

    /* connect_stripe */
    if (action === "connect_stripe") {
      if (!STRIPE_KEY) return json({ error: "Stripe not configured" }, 500);

      const { data: profile } = await admin
        .from("profiles")
        .select("stripe_account_id, stripe_onboarding_complete, stripe_charges_enabled")
        .eq("id", user.id)
        .single();

      let accountId: string = (profile as any)?.stripe_account_id ?? "";

      // If fully connected → return Stripe Express dashboard link
      if ((profile as any)?.stripe_charges_enabled && accountId) {
        const loginLink = await stripePost(STRIPE_KEY, `/accounts/${accountId}/login_links`, {});
        return json({ url: loginLink.url, already_connected: true });
      }

      // Create account if none
      if (!accountId) {
        const account = await stripePost(STRIPE_KEY, "/accounts", {
          type: "express",
          "capabilities[card_payments][requested]": "true",
          "capabilities[transfers][requested]": "true",
          ...(user.email ? { email: user.email } : {}),
        });
        accountId = account.id;
        await admin.from("profiles").update({ stripe_account_id: accountId }).eq("id", user.id);
      }

      // Build return URL — comes back to this dashboard
      const reqUrl = new URL(req.url);
      const dashboardUrl = `${reqUrl.origin}/functions/v1/barber-dashboard`;
      const returnUrl  = body.return_url  ?? dashboardUrl;
      const refreshUrl = body.refresh_url ?? dashboardUrl;

      const accountLink = await stripePost(STRIPE_KEY, "/account_links", {
        account:     accountId,
        return_url:  returnUrl,
        refresh_url: refreshUrl,
        type:        "account_onboarding",
      });

      return json({ url: accountLink.url, account_id: accountId });
    }

    /* update_profile */
    if (action === "update_profile") {
      const updates: any = {};
      if (body.display_name !== undefined) updates.display_name = body.display_name;
      if (body.shop_name    !== undefined) updates.shop_name    = body.shop_name;
      if (body.shop_bio     !== undefined) updates.shop_bio     = body.shop_bio;

      const { error } = await admin.from("profiles").update(updates).eq("id", user.id);
      if (error) return json({ error: error.message }, 400);
      return json({ success: true });
    }

    return json({ error: "Unknown action" }, 400);
  }

  return new Response("Method not allowed", { status: 405 });
});

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/* HTML */
function buildHTML(supabaseUrl: string, supabaseAnonKey: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Kutz Barber Dashboard</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#09090b;color:#fafafa;min-height:100vh}
.page{max-width:860px;margin:0 auto;padding:28px 20px}

/* Auth */
.auth-wrap{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;padding:24px}
.logo{font-size:52px;font-weight:900;letter-spacing:-2px;color:#a855f7;line-height:1}
.logo-sub{color:#52525b;font-size:15px;margin-top:6px;margin-bottom:40px}
.auth-box{background:#141416;border:1px solid #27272a;border-radius:22px;padding:32px;width:100%;max-width:400px}
.auth-box h2{font-size:22px;font-weight:800;letter-spacing:-.4px;text-align:center;margin-bottom:22px}
.field{margin-bottom:16px}
.field label{display:block;font-size:12px;font-weight:700;color:#a1a1aa;margin-bottom:7px;letter-spacing:.3px}
.field input{width:100%;height:50px;background:#09090b;border:1.5px solid #27272a;border-radius:13px;padding:0 16px;font-size:15px;color:#fafafa;outline:none;transition:border-color .15s}
.field input:focus{border-color:#a855f7}
.btn{width:100%;height:52px;border:none;border-radius:14px;font-size:16px;font-weight:700;cursor:pointer;transition:opacity .15s;display:flex;align-items:center;justify-content:center;gap:8px}
.btn:disabled{opacity:.45;cursor:not-allowed}
.btn-purple{background:#a855f7;color:#fff}
.btn-purple:hover:not(:disabled){opacity:.88}
.btn-stripe{background:#635bff;color:#fff}
.btn-stripe:hover:not(:disabled){opacity:.88}
.btn-ghost{background:transparent;border:1.5px solid #27272a;color:#a1a1aa}
.btn-ghost:hover:not(:disabled){border-color:#3f3f46;color:#fafafa}
.auth-err{color:#ef4444;font-size:13px;text-align:center;margin-top:12px;min-height:18px}
.auth-switch{color:#71717a;font-size:14px;text-align:center;margin-top:18px}
.auth-switch a{color:#a855f7;font-weight:700;cursor:pointer;text-decoration:none}

/* Dashboard */
.topbar{display:flex;justify-content:space-between;align-items:center;padding-bottom:24px;border-bottom:1px solid #1e1e22;margin-bottom:28px}
.topbar-brand{font-size:30px;font-weight:900;letter-spacing:-1px;color:#a855f7}
.topbar-right{display:flex;align-items:center;gap:12px}
.topbar-name{font-size:14px;color:#71717a;font-weight:500}
.signout{padding:8px 16px;background:#1a1a1c;border:1px solid #27272a;border-radius:10px;color:#a1a1aa;font-size:13px;font-weight:600;cursor:pointer}
.signout:hover{background:#27272a;color:#fafafa}

.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:32px}
.stat{background:#141416;border:1px solid #1e1e22;border-radius:18px;padding:22px}
.stat-val{font-size:30px;font-weight:900;letter-spacing:-1px}
.stat-lbl{font-size:12px;font-weight:500;color:#71717a;margin-top:5px}

.sec-lbl{font-size:10px;font-weight:700;letter-spacing:.8px;color:#52525b;text-transform:uppercase;margin-bottom:12px}
.card{background:#141416;border:1px solid #1e1e22;border-radius:20px;padding:26px;margin-bottom:28px}

/* Stripe */
.stripe-header{display:flex;align-items:center;gap:14px;margin-bottom:20px}
.stripe-dot{width:11px;height:11px;border-radius:50%;flex-shrink:0}
.dot-green{background:#22c55e;box-shadow:0 0 10px rgba(34,197,94,.4)}
.dot-yellow{background:#f59e0b;box-shadow:0 0 10px rgba(245,158,11,.35)}
.dot-gray{background:#3f3f46}
.stripe-title{font-size:17px;font-weight:800}
.stripe-sub{font-size:13px;color:#71717a;margin-top:3px}
.stripe-features{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:20px}
.feat{background:#09090b;border-radius:14px;padding:16px;text-align:center}
.feat-icon{font-size:26px;margin-bottom:8px}
.feat-title{font-size:13px;font-weight:700}
.feat-desc{font-size:11px;color:#71717a;margin-top:3px}

.spinner{display:inline-block;width:18px;height:18px;border:2.5px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;animation:spin .7s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}

.toast{position:fixed;bottom:28px;left:50%;transform:translateX(-50%);padding:13px 26px;border-radius:14px;font-size:14px;font-weight:600;opacity:0;transition:opacity .25s;pointer-events:none;z-index:999;white-space:nowrap}
.toast.show{opacity:1}

#loading{display:flex;justify-content:center;align-items:center;min-height:60vh}
.big-spinner{width:40px;height:40px;border:3px solid #27272a;border-top-color:#a855f7;border-radius:50%;animation:spin .8s linear infinite}

@media(max-width:600px){
  .stats{grid-template-columns:1fr}
  .stripe-features{grid-template-columns:1fr}
}
</style>
</head>
<body>
<div id="root"></div>
<div class="toast" id="toast"></div>

<script>
/* Escape HTML to prevent XSS */
function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

/* Config */
const SB_URL  = '${supabaseUrl}';
const SB_ANON = '${supabaseAnonKey}';
const API_URL = window.location.pathname; // same function handles API POSTs

/* Minimal Supabase auth (no full SDK needed in browser) */
const sb = {
  _key: 'sb-session',
  session() { try { return JSON.parse(localStorage.getItem(this._key) || 'null'); } catch { return null; } },
  saveSession(s) { localStorage.setItem(this._key, JSON.stringify(s)); },
  clearSession() { localStorage.removeItem(this._key); },

  async signIn(email, password) {
    const r = await fetch(SB_URL + '/auth/v1/token?grant_type=password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SB_ANON },
      body: JSON.stringify({ email, password }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error_description || d.msg || 'Sign in failed');
    this.saveSession(d);
    return d;
  },

  async signUp(email, password, name) {
    const r = await fetch(SB_URL + '/auth/v1/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SB_ANON },
      body: JSON.stringify({ email, password, data: { full_name: name } }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error_description || d.msg || 'Sign up failed');
    if (d.access_token) this.saveSession(d);
    return d;
  },

  async refreshToken() {
    const s = this.session();
    if (!s?.refresh_token) return null;
    const r = await fetch(SB_URL + '/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SB_ANON },
      body: JSON.stringify({ refresh_token: s.refresh_token }),
    });
    if (!r.ok) { this.clearSession(); return null; }
    const d = await r.json();
    this.saveSession(d);
    return d;
  },

  async getToken() {
    let s = this.session();
    if (!s?.access_token) return null;
    // Refresh if expiring within 60s
    const exp = s.expires_at || (s.expires_in ? Date.now()/1000 + s.expires_in : 0);
    if (exp && exp - Date.now()/1000 < 60) {
      s = await this.refreshToken();
    }
    return s?.access_token || null;
  },
};

/* API helper */
async function api(action, extra = {}) {
  const token = await sb.getToken();
  if (!token) throw new Error('Not authenticated');
  const r = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ action, ...extra }),
  });
  const d = await r.json();
  if (!r.ok || d.error) throw new Error(d.error || 'Request failed');
  return d;
}

/* Toast */
function toast(msg, ok = true) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.style.background = ok ? '#22c55e' : '#ef4444';
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2800);
}

/* Auth screen */
let isSignUp = false;

function renderAuth(errMsg = '') {
  document.getElementById('root').innerHTML = \`
    <div class="auth-wrap">
      <div class="logo">Kutz</div>
      <div class="logo-sub">Barber Dashboard</div>
      <div class="auth-box">
        <h2 id="auth-title">\${isSignUp ? 'Create Account' : 'Sign In'}</h2>
        \${isSignUp ? \`<div class="field"><label>NAME</label><input id="f-name" type="text" placeholder="Marcus the Barber" autocomplete="name"></div>\` : ''}
        <div class="field"><label>EMAIL</label><input id="f-email" type="email" placeholder="you@email.com" autocomplete="email"></div>
        <div class="field"><label>PASSWORD</label><input id="f-pass" type="password" placeholder="••••••••" autocomplete="\${isSignUp ? 'new-password' : 'current-password'}"></div>
        <button class="btn btn-purple" id="auth-btn" onclick="handleAuth()">\${isSignUp ? 'Create Account' : 'Sign In'}</button>
        <div class="auth-err" id="auth-err">\${errMsg}</div>
        <div class="auth-switch">
          \${isSignUp ? 'Already have an account?' : 'No account?'}
          <a onclick="toggleMode()">\${isSignUp ? 'Sign in' : 'Create one'}</a>
        </div>
      </div>
    </div>
  \`;
  document.getElementById('f-email')?.focus();
  document.getElementById('f-pass')?.addEventListener('keydown', e => { if (e.key === 'Enter') handleAuth(); });
}

function toggleMode() { isSignUp = !isSignUp; renderAuth(); }

async function handleAuth() {
  const btn = document.getElementById('auth-btn');
  const errEl = document.getElementById('auth-err');
  const email = document.getElementById('f-email').value.trim();
  const pass  = document.getElementById('f-pass').value;
  if (!email || !pass) { errEl.textContent = 'Fill in all fields'; return; }
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>';
  errEl.textContent = '';
  try {
    if (isSignUp) {
      const name = document.getElementById('f-name')?.value.trim() || '';
      const d = await sb.signUp(email, pass, name);
      if (!d.access_token) {
        renderAuth('Check your email to verify, then sign in.');
        return;
      }
    } else {
      await sb.signIn(email, pass);
    }
    await loadDashboard();
  } catch (e) {
    errEl.textContent = e.message;
    btn.disabled = false;
    btn.textContent = isSignUp ? 'Create Account' : 'Sign In';
  }
}

/* Dashboard */
async function loadDashboard() {
  document.getElementById('root').innerHTML = '<div id="loading"><div class="big-spinner"></div></div>';
  try {
    const d = await api('get_profile');
    renderDashboard(d);
  } catch (e) {
    renderAuth(e.message);
  }
}

function renderDashboard({ profile, stats, user }) {
  const p = profile || {};
  const connected = p.stripe_charges_enabled;
  const pending   = p.stripe_account_id && !p.stripe_onboarding_complete;

  document.getElementById('root').innerHTML = \`
    <div class="page">
      <div class="topbar">
        <div class="topbar-brand">Kutz</div>
        <div class="topbar-right">
          <span class="topbar-name">\${esc(user.name || user.email)}</span>
          <button class="signout" onclick="handleSignOut()">Sign out</button>
        </div>
      </div>

      <div class="stats">
        <div class="stat">
          <div class="stat-val">\${stats.totalClients}</div>
          <div class="stat-lbl">Total Clients</div>
        </div>
        <div class="stat">
          <div class="stat-val">\${stats.todayAppointments}</div>
          <div class="stat-lbl">Today's Appointments</div>
        </div>
        <div class="stat">
          <div class="stat-val">$\${(stats.totalRevenue / 100).toFixed(0)}</div>
          <div class="stat-lbl">Total Revenue</div>
        </div>
      </div>

      <p class="sec-lbl">Payments</p>
      <div class="card">
        <div class="stripe-header">
          <div class="stripe-dot \${connected ? 'dot-green' : pending ? 'dot-yellow' : 'dot-gray'}"></div>
          <div>
            <div class="stripe-title">\${connected ? 'Stripe Connected ✓' : pending ? 'Finish Stripe Setup' : 'Connect Stripe'}</div>
            <div class="stripe-sub">\${connected ? 'Payments are live — you can accept cards & do in-person POS' : pending ? 'Onboarding incomplete — click below to finish' : 'Accept card payments online and charge clients in-person'}</div>
          </div>
        </div>

        <button class="btn \${connected ? 'btn-ghost' : 'btn-stripe'}" id="stripe-btn" onclick="handleStripe()" style="width:auto;padding:0 24px">
          \${connected ? 'Open Stripe Dashboard →' : pending ? 'Finish Setup →' : 'Connect Stripe →'}
        </button>

        <div class="stripe-features">
          <div class="feat"><div class="feat-icon">💳</div><div class="feat-title">Card Payments</div><div class="feat-desc">Clients pay at booking</div></div>
          <div class="feat"><div class="feat-icon">📱</div><div class="feat-title">In-Person POS</div><div class="feat-desc">Charge at the chair</div></div>
          <div class="feat"><div class="feat-icon">🏦</div><div class="feat-title">Fast Payouts</div><div class="feat-desc">Weekly to your bank</div></div>
        </div>
      </div>

      <p class="sec-lbl">Mobile App</p>
      <div class="card" style="text-align:center;padding:32px">
        <div style="font-size:44px;margin-bottom:12px">📱</div>
        <div style="font-size:18px;font-weight:800;margin-bottom:6px">Manage everything from the app</div>
        <div style="color:#71717a;font-size:14px;line-height:1.5">Book appointments · Chat with clients · Charge in-person · View loyalty stats</div>
      </div>
    </div>
  \`;
}

async function handleStripe() {
  const btn = document.getElementById('stripe-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Connecting...';
  try {
    const d = await api('connect_stripe', {
      return_url:  window.location.href,
      refresh_url: window.location.href,
    });
    // Redirect to Stripe onboarding or dashboard
    window.location.href = d.url;
  } catch (e) {
    toast(e.message, false);
    btn.disabled = false;
    // Re-render to restore button state
    await loadDashboard();
  }
}

function handleSignOut() {
  sb.clearSession();
  isSignUp = false;
  renderAuth();
}

/* Boot */
(async () => {
  const token = await sb.getToken();
  if (token) {
    await loadDashboard();
  } else {
    renderAuth();
  }
})();
</script>
</body>
</html>`;
}
