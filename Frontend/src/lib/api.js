import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

// ---------- Session et identifiant de navigateur ----------
const TOKEN_KEY = "breachradar-token";
const CLIENT_KEY = "breachradar-client-id";

const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch { /* stockage indisponible */ } },
};

export const getToken = () => store.get(TOKEN_KEY);
export const setToken = (token) => store.set(TOKEN_KEY, token);

const newId = () =>
  (crypto?.randomUUID ? crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  }));

// Historique et surveillance sont privés : liés au compte connecté, sinon à ce navigateur.
let clientId = store.get(CLIENT_KEY);
if (!clientId) { clientId = newId(); store.set(CLIENT_KEY, clientId); }

axios.interceptors.request.use((config) => {
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  config.headers["X-Client-Id"] = clientId;
  return config;
});

export const errorMessage = (e, fallback) => {
  const detail = e?.response?.data?.detail;
  return typeof detail === "string" ? detail : fallback;
};

export const investigate = (target) =>
  axios.post(`${API}/investigate`, { target }).then((r) => r.data);

export const investigateBatch = (targets) =>
  axios.post(`${API}/investigate/batch`, { targets }).then((r) => r.data);

export const generateReport = (id) =>
  axios.post(`${API}/investigation/${id}/report`).then((r) => r.data);

export const getHistory = () => axios.get(`${API}/history`).then((r) => r.data);

export const deleteInvestigation = (id) =>
  axios.delete(`${API}/investigation/${id}`).then((r) => r.data);

export const clearHistory = () => axios.delete(`${API}/history`).then((r) => r.data);

// Watchlist / alerts
export const addWatch = (target) =>
  axios.post(`${API}/watchlist`, { target }).then((r) => r.data);

export const getWatchlist = () => axios.get(`${API}/watchlist`).then((r) => r.data);

export const checkWatch = (id) =>
  axios.post(`${API}/watchlist/${id}/check`).then((r) => r.data);

export const checkAllWatches = () =>
  axios.post(`${API}/watchlist/check-all`).then((r) => r.data);

export const markWatchSeen = (id) =>
  axios.post(`${API}/watchlist/${id}/seen`).then((r) => r.data);

export const deleteWatch = (id) =>
  axios.delete(`${API}/watchlist/${id}`).then((r) => r.data);

// ---------- Compte ----------
export const register = (email, password, acceptTerms) =>
  axios.post(`${API}/auth/register`, { email, password, accept_terms: acceptTerms }).then((r) => r.data);
export const exportMyData = () => axios.get(`${API}/auth/export`).then((r) => r.data);
export const deleteMyAccount = (password) =>
  axios.delete(`${API}/auth/account`, { data: { password } }).then((r) => r.data);
export const verifyAccount = (email, code) =>
  axios.post(`${API}/auth/verify`, { email, code }).then((r) => r.data);
export const resendAccountCode = (email) =>
  axios.post(`${API}/auth/resend`, { email }).then((r) => r.data);
export const login = (email, password) =>
  axios.post(`${API}/auth/login`, { email, password }).then((r) => r.data);
export const forgotPassword = (email) =>
  axios.post(`${API}/auth/forgot`, { email }).then((r) => r.data);
export const resetPassword = (email, code, password) =>
  axios.post(`${API}/auth/reset`, { email, code, password }).then((r) => r.data);
export const getMe = () => axios.get(`${API}/auth/me`).then((r) => r.data);

// ---------- Abonnement ----------
export const getBillingConfig = () => axios.get(`${API}/billing/config`).then((r) => r.data);
export const activateSubscription = (subscriptionId) =>
  axios.post(`${API}/billing/paypal/subscription`, { subscription_id: subscriptionId }).then((r) => r.data);
export const cancelSubscription = () => axios.post(`${API}/billing/cancel`).then((r) => r.data);
export const startStripeCheckout = (plan, promoCode) =>
  axios.post(`${API}/billing/stripe/checkout`, { plan, promo_code: promoCode || null }).then((r) => r.data);
export const createPaypalSubscription = (plan, promoCode) =>
  axios.post(`${API}/billing/paypal/create`, { plan, promo_code: promoCode || null }).then((r) => r.data);
export const checkPromo = (code, plan) =>
  axios.post(`${API}/billing/promo/check`, { code, plan }).then((r) => r.data);
export const confirmStripeCheckout = (sessionId) =>
  axios.post(`${API}/billing/stripe/confirm`, { session_id: sessionId }).then((r) => r.data);
export const getLegal = () => axios.get(`${API}/legal`).then((r) => r.data);
export const getStats = () => axios.get(`${API}/stats`).then((r) => r.data);

// ---------- Premium ----------
export const getMonitors = () => axios.get(`${API}/premium/monitors`).then((r) => r.data);
export const addMonitor = (email) =>
  axios.post(`${API}/premium/monitors`, { email }).then((r) => r.data);
export const verifyMonitor = (id, code) =>
  axios.post(`${API}/premium/monitors/${id}/verify`, { code }).then((r) => r.data);
export const resendMonitorCode = (id) =>
  axios.post(`${API}/premium/monitors/${id}/resend`).then((r) => r.data);
export const markMonitorSeen = (id) =>
  axios.post(`${API}/premium/monitors/${id}/seen`).then((r) => r.data);
export const deleteMonitor = (id) =>
  axios.delete(`${API}/premium/monitors/${id}`).then((r) => r.data);
export const getPasswordReport = (email) =>
  axios.get(`${API}/premium/password-report`, { params: { email } }).then((r) => r.data);

// ---------- Administration ----------
const adminGet = (path, params) => axios.get(`${API}/admin${path}`, { params }).then((r) => r.data);
const adminSend = (method, path, data) => axios({ method, url: `${API}/admin${path}`, data }).then((r) => r.data);
export const admin = {
  overview: () => adminGet("/overview"),
  users: (params) => adminGet("/users", params),
  grantPremium: (id, until, note) => adminSend("post", `/users/${id}/premium`, { until, note }),
  revokePremium: (id) => adminSend("post", `/users/${id}/revoke`),
  cancelSubscription: (id) => adminSend("post", `/users/${id}/cancel`),
  syncSubscription: (id) => adminSend("post", `/users/${id}/sync`),
  deleteUser: (id) => adminSend("delete", `/users/${id}`),
  payments: () => adminGet("/payments"),
  savePayments: (data) => adminSend("put", "/payments", data),
  createPlans: (provider, monthly, yearly) => adminSend("post", "/payments/create-plans", { provider, monthly, yearly }),
  smtp: () => adminGet("/smtp"),
  saveSmtp: (data) => adminSend("put", "/smtp", data),
  resetSmtp: () => adminSend("delete", "/smtp"),
  testSmtp: (to, service) => adminSend("post", "/smtp/test", { to: to || null, service }),
  smtpUsage: () => adminGet("/smtp/usage"),
  legal: () => adminGet("/legal"),
  saveLegal: (data) => adminSend("put", "/legal", data),
  audit: () => adminGet("/audit"),
  statsDisplay: () => adminGet("/stats-display"),
  saveStatsDisplay: (data) => adminSend("put", "/stats-display", data),
  promos: () => adminGet("/promos"),
  createPromo: (data) => adminSend("post", "/promos", data),
  setPromoActive: (id, active) => adminSend("patch", `/promos/${id}`, { active }),
  deletePromo: (id) => adminSend("delete", `/promos/${id}`),
  promoRedemptions: (id) => adminGet(`/promos/${id}/redemptions`),
};
