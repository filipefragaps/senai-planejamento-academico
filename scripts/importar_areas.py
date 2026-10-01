"""
Vincula professores às suas áreas via POST /professores/importar-areas.

Uso:
    python scripts/importar_areas.py --url https://<backend> --token <jwt>

O token pode ser obtido em /auth/login antes.
"""
import argparse, json, sys
try:
    import requests
except ImportError:
    sys.exit("pip install requests")

AREAS = [
    {"nome": "ADRIANE FARIA DE ALMEIDA", "area": "AUTOMAÇÃO"},
    {"nome": "ALAN JOHNES FELIX DE SOUSA", "area": "ELÉTRICA"},
    {"nome": "ALESSANDRO RIBEIRO DE SOUSA LACERDA", "area": "GESTÃO"},
    {"nome": "ALMIR ALVES DA SILVA", "area": "AVIAÇÃO"},
    {"nome": "ANA RAFAELA SOBRINHO DE MIRANDA", "area": "AUTOMAÇÃO"},
    {"nome": "ANISIO DE GODOI FILHO", "area": "MECÂNICA"},
    {"nome": "BERTHIE DE CASTRO FURTADO", "area": "ELÉTRICA"},
    {"nome": "BOANERGES CIPRIANO GOMES NETO", "area": "AUTOMAÇÃO"},
    {"nome": "BRENO DE ALMEIDA QUINTINO", "area": "AUTOMAÇÃO"},
    {"nome": "BRUNO GOMES DA SILVA", "area": "ELÉTRICA"},
    {"nome": "CARLOS EDUARDO DE SOUZA MAGALHAES", "area": "ELÉTRICA"},
    {"nome": "CHARLLES DE MORAIS BORGES", "area": "MECÂNICA"},
    {"nome": "CRISTIANE RODRIGUES MACHADO DE OLIVEIRA", "area": "GESTÃO"},
    {"nome": "DIONE DE SOUZA CIELE", "area": "MECÂNICA"},
    {"nome": "DLLUBIA SANTCLAIR MATIAS", "area": "MECÂNICA"},
    {"nome": "ELSON PEREIRA DE BRITO", "area": "MECÂNICA"},
    {"nome": "ENI GODINHO DE OLIVEIRA", "area": "VESTUÁRIO"},
    {"nome": "ENZO FRANCESCO THEODORO DE CICCO", "area": "AUTOMAÇÃO"},
    {"nome": "ERICK GOMES PIRES", "area": "AUTOMAÇÃO"},
    {"nome": "EURANESE GONCALVES DA MATA GUIMARAES", "area": "VESTUÁRIO"},
    {"nome": "FELIPE DA SILVA ROSA DA COSTA", "area": "FICTEC"},
    {"nome": "FLAVIO AUGUSTO GLAPINSKI ZACCA", "area": "AUTOMAÇÃO"},
    {"nome": "GILBERTO CARVALHO RIBEIRO", "area": "ELÉTRICA"},
    {"nome": "GIOVANE MARQUES DE ALMEIDA", "area": "MECÂNICA"},
    {"nome": "GUSTAVO DE CASTRO LOPES", "area": "AUTOMAÇÃO"},
    {"nome": "HELLAYNE CRISTINA SANTOS DE CASTRO", "area": "FICTEC"},
    {"nome": "HUMBERTO AMANCIO ALENCAR DA SILVA", "area": "ELÉTRICA"},
    {"nome": "INGREDY GABRIELA GOMES CARMO", "area": "AUTOMAÇÃO"},
    {"nome": "IRACILDA NOVAIS MENDES", "area": "VESTUÁRIO"},
    {"nome": "ISABELLA DE PAULA FARIA MARTINEZ", "area": "FICTEC"},
    {"nome": "JANIO LAZARO DE ALBUQUERQUE", "area": "ELÉTRICA"},
    {"nome": "JOAO PAULO MUNIZ", "area": "GESTÃO"},
    {"nome": "JOAO VITOR RODRIGUES ARAUJO", "area": "FICTEC"},
    {"nome": "JULIO MODESTO BEGHELLI", "area": "FICTEC"},
    {"nome": "KAMILLA RAMOS E SILVA", "area": "VESTUÁRIO"},
    {"nome": "KARINA FERNANDES AMARAL", "area": "VESTUÁRIO"},
    {"nome": "KAROLINE ELIZA TESTONI GONCALVES", "area": "FICTEC"},
    {"nome": "LEONARDO FERNANDES FIGUEREDO", "area": "FICTEC"},
    {"nome": "LUCAS HERMETO ZOCCOLI NOGUEIRA", "area": "AUTOMAÇÃO"},
    {"nome": "LUCIANO DOS SANTOS REIS", "area": "ELÉTRICA"},
    {"nome": "LUIZ CARLOS RIBEIRO DA COSTA", "area": "FICTEC"},
    {"nome": "LUIZ FELIPE GOMES DA SILVA", "area": "MECÂNICA"},
    {"nome": "MARCELO GLAYSON EUFRASIO DE CASTRO", "area": "MECÂNICA"},
    {"nome": "MARCELO VALENTIM HECK", "area": "MARCENARIA"},
    {"nome": "MARCOS LEVI MATOS", "area": "AUTOMAÇÃO"},
    {"nome": "MARCOS MESSIAS DA CRUZ", "area": "MECÂNICA"},
    {"nome": "MARCUS VINICIUS MARTINS FREITAS", "area": "MECÂNICA"},
    {"nome": "MARLUCIA APARECIDA DOS SANTOS", "area": "FICTEC"},
    {"nome": "MATHEUS CARRARA MARTINS", "area": "AUTOMAÇÃO"},
    {"nome": "MELL OHANO GUIMARAES COSTA", "area": "FICTEC"},
    {"nome": "MIRIAN SANDY ARAUJO DA SILVA", "area": "ELÉTRICA"},
    {"nome": "MORGANA COSTA BARBOSA", "area": "FICTEC"},
    {"nome": "NELIO NEVES LIMA", "area": "AUTOMAÇÃO"},
    {"nome": "OTAVIO RIBEIRO CHAVES", "area": "AUTOMAÇÃO"},
    {"nome": "OTAVIO SERGIO DE ARAUJO E NOGUEIRA", "area": "AUTOMAÇÃO"},
    {"nome": "ROGERIO PEREIRA BATISTA", "area": "AUTOMAÇÃO"},
    {"nome": "SONIA NUNES DOS SANTOS MENDES", "area": "VESTUÁRIO"},
    {"nome": "TEODOMIRO PEREIRA DA COSTA JUNIOR", "area": "VESTUÁRIO"},
    {"nome": "THIAGO ALEXANDER FLORES", "area": "MECÂNICA"},
    {"nome": "THIAGO YORRARA OLIVEIRA", "area": "ELÉTRICA"},
    {"nome": "THYAGO MARINHO LOPES SILVA", "area": "MECÂNICA"},
    {"nome": "WANDERSON RAINER HILARIO DE ARAUJO", "area": "AUTOMAÇÃO"},
    {"nome": "WESLLEY DA SILVA ALVES", "area": "FICTEC"},
    {"nome": "WEUDS LUCIANO VIEIRA", "area": "MECÂNICA"},
    {"nome": "WILLIAM ANTUNES BENERI", "area": "MECÂNICA"},
    {"nome": "WILLIAM CARLOS DE ANDRADE", "area": "AVIAÇÃO"},
    {"nome": "ZILDOMAR DOMINGOS ROSA", "area": "MECÂNICA"},
]

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", required=True, help="URL base do backend, ex: https://api.exemplo.com")
    ap.add_argument("--token", required=True, help="JWT de autenticação (admin)")
    args = ap.parse_args()

    base = args.url.rstrip("/")
    headers = {"Authorization": f"Bearer {args.token}", "Content-Type": "application/json"}

    resp = requests.post(f"{base}/api/v1/professores/importar-areas", headers=headers, json=AREAS)
    resp.raise_for_status()
    data = resp.json()

    print(f"\nVinculados: {data['vinculados']}")
    if data["nao_encontrados"]:
        print(f"\nNao encontrados ({len(data['nao_encontrados'])}):")
        for n in data["nao_encontrados"]:
            print(f"  - {n}")
    else:
        print("Todos vinculados com sucesso!")

if __name__ == "__main__":
    main()
