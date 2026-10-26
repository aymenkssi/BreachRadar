import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

export const investigate = (target) =>
  axios.post(`${API}/investigate`, { target }).then((r) => r.data);

export const investigateBatch = (targets) =>
  axios.post(`${API}/investigate/batch`, { targets }).then((r) => r.data);

export const generateReport = (id) =>
  axios.post(`${API}/investigation/${id}/report`).then((r) => r.data);

export const checkPassword = (password) =>
  axios.post(`${API}/check-password`, { password }).then((r) => r.data);

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
