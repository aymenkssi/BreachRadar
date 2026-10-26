import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { getMe, getToken, setToken } from "@/lib/api";

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      setReady(true);
      return null;
    }
    try {
      const me = await getMe();
      setUser(me);
      return me;
    } catch (e) {
      if (e?.response?.status === 401) { setToken(null); setUser(null); }
      return null;
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const signIn = (session) => { setToken(session.token); setUser(session.user); };
  const signOut = () => { setToken(null); setUser(null); };

  return (
    <AuthContext.Provider value={{ user, ready, refresh, signIn, signOut, setUser }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
