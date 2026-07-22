import { NextRequest, NextResponse } from "next/server";

const ROTAS_PUBLICAS = ["/login"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get("access_token")?.value;

  const isPublica = ROTAS_PUBLICAS.some((r) => pathname.startsWith(r));

  if (!token) {
    if (isPublica) return NextResponse.next();
    // Não autenticado tentando acessar rota protegida → login
    const url = new URL("/login", request.url);
    url.searchParams.set("redirect", pathname);
    return NextResponse.redirect(url);
  }

  // Autenticado tentando acessar /login → redireciona para dashboard
  if (isPublica) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Protege tudo exceto arquivos estáticos e internos do Next.js
    "/((?!_next/static|_next/image|favicon.ico|senai-logo.*\\.png|.*\\.svg|.*\\.ico).*)",
  ],
};
