/**
 * SMS texts. Customers get Portuguese; staff texts are short and also in Portuguese.
 * TODO(EDM): have a native speaker review the wording before go-live.
 */
export const sms = {
  customerReceived: (code: string) =>
    `EDM: Recebemos o seu pedido ${code}. Um técnico será enviado. Enviaremos atualizações por SMS.`,
  customerWorking: (code: string) => `EDM: O técnico está a trabalhar no seu pedido ${code}.`,
  customerClosed: (code: string) => `EDM: O seu pedido ${code} foi resolvido. Obrigado.`,
  managerNewTicket: (code: string, title: string) =>
    `EDM Tasks: Novo ticket ${code} (${title}) aguarda atribuição.`,
  staffAssigned: (code: string, title: string) =>
    `EDM Tasks: Novo trabalho ${code} – ${title}. Abra a app EDM Field.`,
  teamJob: (code: string, title: string) =>
    `EDM Tasks: Novo trabalho para a equipa ${code} – ${title}. Quem aceitar primeiro na app fica com ele.`,
  teamJobReminder: (code: string, title: string) =>
    `EDM Tasks: O trabalho ${code} – ${title} ainda não tem técnico. Aceite-o na app EDM Field.`,
  managerReopened: (code: string) => `EDM Tasks: O ticket ${code} foi reaberto. Por favor atribua novamente.`,
  managerDeclined: (code: string, staffName: string) =>
    `EDM Tasks: ${staffName} recusou o ticket ${code}. Por favor atribua a outra pessoa.`,
  staffUnassigned: (code: string) => `EDM Tasks: O trabalho ${code} foi passado a outro técnico.`,
  customerKnownOutage: (code: string) =>
    `EDM: Recebemos o seu pedido ${code}. Já sabemos da avaria na sua zona e uma equipa está a trabalhar nela.`,
  customerPowerBack: (code: string) =>
    `EDM: A avaria na sua zona foi reparada (pedido ${code}). Obrigado pela paciência.`,
  customerOutageUpdate: (code: string) =>
    `EDM: Pedido ${code}: a equipa continua a trabalhar na avaria da sua zona. Avisaremos quando a energia voltar.`,
  nocNewIncident: (code: string, title: string) => `EDM NOC: Novo incidente de rede ${code} – ${title}.`,
  staffDueSoon: (code: string, minutes: number) =>
    `EDM Tasks: O trabalho ${code} tem de ficar pronto em ${minutes} min.`,
  late: (code: string, title: string) => `EDM Tasks: O ticket ${code} (${title}) passou o prazo.`,
  badlyLate: (code: string, title: string, hours: number) =>
    `EDM Tasks: O ticket ${code} (${title}) está muito atrasado (${hours} h desde a abertura).`,
  staffAlarmsCleared: (code: string) =>
    `EDM Tasks: O NMS diz que todos os alarmes do ${code} terminaram. Confirme no local e feche o trabalho na app.`,
  customerSurveyReceived: (code: string) =>
    `EDM: Recebemos o seu pedido de ligação (${code}). Um técnico vai visitar o local para uma vistoria.`,
  customerSurveyDone: (code: string) =>
    `EDM: A vistoria ${code} foi feita. A equipa comercial vai contactá-lo com o resultado.`,
  customerConnectionReceived: (code: string) =>
    `EDM: O seu contrato foi registado (${code}). Uma equipa vai fazer a ligação e avisaremos por SMS.`,
  customerHandoverCode: (code: string) =>
    `EDM: O seu código para confirmar a ligação é ${code}. Dê-o ao técnico só depois de verificar que tem energia.`,
  customerConnected: (code: string) => `EDM: A sua ligação ${code} está ativa. Bem-vindo à EDM!`,
  boNewHelp: (who: string, kind: string) => `EDM BO: ${who} pede ajuda (${kind}). Veja os pedidos de ajuda.`,
  staffHelpReply: (body: string) => `EDM BO: ${body}`.slice(0, 300),
  staffNote: (code: string, from: string, text: string) =>
    `EDM Tasks ${code} – ${from}: ${text}`.slice(0, 300),
  staffCancelled: (code: string) => `EDM Tasks: O trabalho ${code} foi cancelado. Não é preciso ir ao local.`
};

/** Titles of push notifications to the EDM Field app; the text is the same as the SMS. */
export const push = {
  newJob: 'Novo trabalho',
  teamJob: 'Novo trabalho para a equipa',
  teamJobReminder: 'Trabalho ainda sem técnico',
  jobMoved: 'Trabalho passado a outro técnico',
  jobCancelled: 'Trabalho cancelado',
  note: 'Mensagem do escritório',
  dueSoon: 'Prazo a terminar',
  late: 'Trabalho atrasado',
  alarmsCleared: 'Alarmes terminados',
  helpReply: 'Resposta do BO'
};

/** The same office alerts as they appear under the bell in the web app, which is in English. */
export const inbox = {
  newTicket: (code: string, title: string) => `${code} ${title} is waiting to be assigned`,
  declined: (code: string, staffName: string) => `${staffName} gave back ${code}: assign someone else`,
  reopened: (code: string) => `${code} was not fixed after the check: assign it again`,
  newIncident: (code: string, title: string) => `New network incident ${code}: ${title}`,
  alarmOnFixed: (code: string, alarmType: string) =>
    `New alarm on ${code}, which was reported fixed: ${alarmType}`,
  late: (code: string, title: string) => `${code} ${title} is past its time limit`,
  badlyLate: (code: string, title: string, hours: number) =>
    `${code} ${title} is badly late (${hours} h since it was opened)`,
  help: (who: string, kind: string) => `${who} asks for help: ${kind}`
};

/** Messages to office staff: SMS (when they have a phone) and the same alert under the bell in the web app. */
export function toOffice(
  people: { id: string; phone: string | null }[],
  body: string,
  title: string,
  ticketId: string | null,
  link?: string
) {
  return people.map((p) => ({
    recipient: p.phone,
    body,
    ticketId,
    office: { userId: p.id, title, link }
  }));
}
