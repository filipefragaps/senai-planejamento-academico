import { NextRequest, NextResponse } from "next/server";

const ROTAS_PUBLICAS = ["/login"];

const ALLOWED_ROUTES: Record<string, string[]> = {
  admin:       [], // empty = todas as rotas permitidas
  coordenador: ["/cronograma", "/ofertas", "/professores", "/cursos", "/eventos", "/ambientes", "/relatorios", "/ia", "/perfil"],
  analista:    ["/cronograma", "/ofertas", "/professores", "/cursos", "/relatorios", "/perfil"],
  secretario:  ["/cronograma", "/cursos", "/ofertas", "/relatorios", "/perfil"],
  professor:   ["/cronograma", "/perfil"],
  atendente:   ["/ofertas", "/cursos", "/perfil"],
  consultor:   ["/ofertas", "/cursos", "/perfil"],
};

const PERFIL_HOME: Record<string, string> = {
  admin:       "/dashboard",
  coordenador: "/cronograma",
  analista:    "/cronograma",
  secretario:  "/cronograma",
  professor:   "/cronograma",
  atendente:   "/ofertas",
  consultor:   "/ofertas",
};

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get("access_token")?.value;
  const perfil = request.cookies.get("user_perfil")?.value;

  const isPublica = ROTAS_PUBLICAS.some((r) => pathname.startsWith(r));

  if (!token) {
    if (isPublica) return NextResponse.next();
    const url = new URL("/login", request.url);
    url.searchParams.set("redirect", pathname);
    return NextResponse.redirect(url);
  }

  // Autenticado tentando acessar /login → redireciona para home do perfil
  if (isPublica) {
    const home = perfil ? (PERFIL_HOME[perfil] ?? "/dashboard") : "/dashboard";
    return NextResponse.redirect(new URL(home, request.url));
  }

  // Verifica acesso por perfil (só quando o cookie user_perfil está presente)
  if (perfil && perfil in ALLOWED_ROUTES) {
    const allowed = ALLOWED_ROUTES[perfil];
    if (allowed.length > 0) {
      const hasAccess = allowed.some(
        (route) => pathname === route || pathname.startsWith(route + "/")
      );
      if (!hasAccess) {
        const home = PERFIL_HOME[perfil] ?? "/cronograma";
        return NextResponse.redirect(new URL(home, request.url));
      }
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|senai-logo.*\\.png|.*\\.svg|.*\\.ico).*)",
  ],
};
