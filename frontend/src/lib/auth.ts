import Cookies from "js-cookie";

const TOKEN_KEY = "access_token";
const USER_KEY = "current_user";

export function getToken(): string | null {
  return Cookies.get(TOKEN_KEY) || null;
}

export function setToken(token: string, userData: any) {
  Cookies.set(TOKEN_KEY, token, { expires: 1, sameSite: "lax" });
  if (userData?.perfil) {
    Cookies.set("user_perfil", userData.perfil, { expires: 1, sameSite: "lax" });
  }
  if (typeof window !== "undefined") {
    localStorage.setItem(USER_KEY, JSON.stringify(userData));
  }
}

export function clearAuth() {
  Cookies.remove(TOKEN_KEY);
  Cookies.remove("user_perfil");
  if (typeof window !== "undefined") {
    localStorage.removeItem(USER_KEY);
  }
}

export function getCurrentUser() {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function isAuthenticated(): boolean {
  return !!getToken();
}
