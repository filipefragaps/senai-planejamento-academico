import * as XLSX from "xlsx";

function download(wb: XLSX.WorkBook, fileName: string) {
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadModeloDadosMestres() {
  const wb = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["PROFESSOR", "ÁREA", "TIPO", "CH"],
      ["João Silva", "Informática", "Mensalista", 40],
      ["Maria Santos", "Elétrica", "Horista", 20],
    ]),
    "PROFESSORES"
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["PROFESSOR", "CURSO", "PASTA", "UNIDADE CURRICULAR", "AT"],
      ["João Silva", "Técnico em Informática", "INF", "Programação Web", "SIM"],
      ["Maria Santos", "Técnico em Elétrica", "ELE", "Instalações Residenciais", "SIM"],
    ]),
    "ATUAÇÃO"
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["PROFESSOR", "DIA_SEMANA", "HORA_INICIO", "HORA_FIM", "DISPONIVEL"],
      ["João Silva", "SEG", "08:00", "12:00", "SIM"],
      ["João Silva", "TER", "19:00", "22:00", "SIM"],
      ["Maria Santos", "QUA", "13:00", "17:00", "SIM"],
    ]),
    "DISPONIBILIDADE DETALHADA"
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["DATA", "TIPO", "LETIVO", "TURNO", "DESCRIÇÃO"],
      ["25/12/2025", "Feriado", "NÃO", "", "Natal"],
      ["01/01/2026", "Feriado", "NÃO", "", "Ano Novo"],
      ["15/07/2026", "Recesso", "NÃO", "", "Recesso de Julho"],
    ]),
    "CALENDÁRIO ACADÊMICO"
  );

  download(wb, "modelo_dados_mestres.xlsx");
}

const COLUNAS_OFERTAS = [
  "MODALIDADE", "ÁREA", "PASTA", "CURSO", "EVENTO", "TURNO",
  "DIAS SEMANA", "CIDADE", "C.H", "HORA INÍCIO", "HORA TÉRMINO",
  "DATA INÍCIO", "DATA TÉRMINO", "STATUS", "VAGAS", "MIN. PARA INÍCIO",
  "PARCELAS BOLETO", "VALOR IND.", "PARCELA COM DESC.", "TOTAL POR ALUNO",
  "HORA AULA", "ALUNOS MATRICULADOS",
];

const EXEMPLO_OFERTA = [
  "Presencial", "Informática", "INF", "Técnico em Informática",
  "TEC-INF-2026-1", "Noite", "Segunda e Quarta", "Goiânia",
  800, "19:00", "22:00", "02/02/2026", "30/11/2026",
  "PLANEJADO", 30, 20, 10, 1200.00, 1100.00, 12000.00, 3, 0,
];

export function downloadModeloOfertas() {
  const wb = XLSX.utils.book_new();

  for (const aba of ["1° SEMESTRE", "2° SEMESTRE"]) {
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([COLUNAS_OFERTAS, EXEMPLO_OFERTA]),
      aba
    );
  }

  download(wb, "modelo_ofertas_senai.xlsx");
}

export function downloadModeloHistorico() {
  const wb = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      [
        "Data", "Evento", "Turno", "Horário", "Curso", "Unidade C",
        "Aula", "Subturma", "Professor", "Ambiente", "Hora Aula",
        "Etapa", "Modalidade", "Área", "Contrato", "Obs", "Status",
      ],
      [
        "15/03/2025", "TEC-INF-2026-1", "Noite", "19:00 - 22:00",
        "Técnico em Informática", "Programação Web", 1, "",
        "João Silva", "Lab Informática 1", 3, "BÁSICO",
        "Presencial", "Informática", "Mensalista", "", "Realizada",
      ],
    ]),
    "Cronograma"
  );

  download(wb, "modelo_historico_aulas.xlsx");
}
