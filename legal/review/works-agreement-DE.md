<!--
================================================================================
 ENGLISH PREAMBLE — navigation aid for non-German readers (Sandesh et al.)
================================================================================

**File:** `legal/review/works-agreement-DE.md` — Betriebsvereinbarung (German
works agreement) template. Authoritative body in German below; this preamble is
advisory and non-binding. Owner: Workstream I (Compliance). Tracks
`dev-docs/workstreams/i-compliance-prd.md` §5 catalog row.

**STATUS: TEMPLATE — requires DE-qualified employment counsel review before use
with any customer. Do NOT ship without external counsel sign-off (compliance
PRD §10.1, action E-1).**

**Who uses this file.** The customer's `{{ARBEITGEBER}}` (employer) and
`{{BETRIEBSRAT_VORSITZ}}` (works-council chair) execute this Betriebsvereinbarung
covering a DevMetrics deployment. DevMetrics (the vendor) does NOT sign this
agreement — the signatories are employer and Betriebsrat. Vendor-side
commitments are covered by a separate DPA (Phase 2).

**Statutory trigger.** **BetrVG §87(1) Nr. 6** — mandatory works-council
co-determination on any technical system objectively suitable to monitor
employee performance or behavior. Per EDPB Opinion 2/2017, intent is
irrelevant. DevMetrics is suitable by construction; co-determination applies in
German operations with a works council. Collateral: BDSG §26; DSGVO Art. 5 / 6
/ 13 / 15 / 17 / 20 / 25 / 30 / 35.

**Placeholders (replace before execution).**
- `{{ARBEITGEBER}}` — employer legal name.
- `{{BETRIEBSRAT_VORSITZ}}` — works-council chair name.
- `{{EFFECTIVE_DATE}}` — ISO date (YYYY-MM-DD).
- `{{PRODUCTION_VERSION}}` — DevMetrics release tag.
- `{{TENANT_ID}}` — tenant identifier.
- `{{DPO_EMAIL}}` — customer DPO mailbox.
- `{{ESCALATION_CONTACT}}` — vendor escalation contact.

**Cross-references.** Paragraph-by-paragraph mapping from §6 rights to
statutory citations and product controls: `legal/review/bill-of-rights-rider.md`
(compliance PRD §6.2 — the rider is a contractual attachment). DPIA:
`legal/review/DPIA.md`. SCCs Module 2 (if cross-border transfer):
`legal/review/SCCs-module-2.md`.

**Lane boundary.** Owned solely by Workstream I. Product-side controls
(`devmetrics audit --tail`, `audit_events`, `devmetrics erase`, Tier B default,
Ed25519 tier flip) are cited as descriptive of the shipped product per
CLAUDE.md and PRD §5–§8 — not redesigned here.

**Navigating the German body.** Numbering is standard Betriebsvereinbarung
practice: `§1 Abs. 1` = Section 1 Paragraph 1; sub-clauses `(1)`, `(2)`;
lettered `a)`, `b)`. The verbatim prohibition clause (CLAUDE.md "Compliance
Rules") appears exactly once in §5 Abs. 1. In any conflict, the German body
controls.

================================================================================
-->

# Betriebsvereinbarung über den Einsatz von DevMetrics

**zwischen**

{{ARBEITGEBER}} — im Folgenden "Arbeitgeber" —

**und**

dem Betriebsrat, vertreten durch {{BETRIEBSRAT_VORSITZ}} — im Folgenden "Betriebsrat" —

gemeinsam die "Parteien".

**In Kraft ab:** {{EFFECTIVE_DATE}}
**Softwarestand:** {{PRODUCTION_VERSION}}
**Mandantenkennung:** {{TENANT_ID}}

---

## §1 Präambel

(1) Die Parteien schließen diese Betriebsvereinbarung im Hinblick auf die
Einführung und Nutzung des technischen Systems "DevMetrics" (im Folgenden das
"System") im Betrieb des Arbeitgebers. Das System dient der Erfassung, Auswertung
und Darstellung von Nutzungsdaten KI-gestützter Entwicklungswerkzeuge
(insbesondere Claude Code, Codex, Cursor, Continue.dev, GitHub Copilot und
vergleichbarer Codeassistenten) zu Zwecken der Kostensteuerung (FinOps), der
Zuverlässigkeitsanalyse und der aggregierten Teamauswertung.

(2) Zweck dieser Vereinbarung ist es, die Mitbestimmungsrechte des Betriebsrats
nach § 87 Abs. 1 Nr. 6 BetrVG sowie die Rechte der Beschäftigten nach dem
Datenschutzrecht (insbesondere der Verordnung (EU) 2016/679 — DSGVO — sowie des
Bundesdatenschutzgesetzes — BDSG) zu wahren und die zulässigen
Verarbeitungszwecke, Rechte und Pflichten transparent und verbindlich zu regeln.

(3) Die Parteien sind sich einig, dass das System grundsätzlich geeignet ist,
Leistung und Verhalten der Beschäftigten zu überwachen, und daher der
Mitbestimmung des Betriebsrats nach § 87 Abs. 1 Nr. 6 BetrVG unterliegt. Die
Geeignetheit im Sinne der Rechtsprechung des Bundesarbeitsgerichts und der
Leitlinie 2/2017 des Europäischen Datenschutzausschusses wird unabhängig von
der Absicht des Arbeitgebers festgestellt; diese Vereinbarung regelt die
daraus folgenden Schutzmaßnahmen.

(4) Rechtsgrundlagen dieser Vereinbarung sind insbesondere:
- Betriebsverfassungsgesetz (BetrVG), insbesondere §§ 75, 80, 87 Abs. 1 Nr. 6;
- Bundesdatenschutzgesetz (BDSG), insbesondere § 26;
- Verordnung (EU) 2016/679 (DSGVO), insbesondere Art. 5, 6, 13, 15, 17, 20, 25,
  30, 35;
- einschlägige Rechtsprechung und aufsichtsbehördliche Leitlinien, insbesondere
  die Leitlinie 2/2017 des Europäischen Datenschutzausschusses zur
  Datenverarbeitung am Arbeitsplatz.

---

## §2 Geltungsbereich

(1) Diese Betriebsvereinbarung gilt räumlich für sämtliche Betriebsstätten des
Arbeitgebers in der Bundesrepublik Deutschland, in denen das System eingesetzt
wird.

(2) Persönlich gilt diese Vereinbarung für alle Beschäftigten im Sinne des § 5
BetrVG, deren Endgeräte oder Zugänge zu Entwicklungsumgebungen durch das System
erfasst werden. Sie gilt entsprechend für arbeitnehmerähnliche Personen sowie,
soweit rechtlich zulässig und vertraglich vereinbart, für freie Mitarbeiter und
Werkvertragsnehmer, die auf den genannten Endgeräten oder Systemen tätig sind.

(3) Sachlich gilt diese Vereinbarung für sämtliche Vorgänge im Zusammenhang mit
der Erhebung, Übermittlung, Speicherung, Pseudonymisierung, Auswertung und
Löschung von Daten durch das System, einschließlich der serverseitigen
Redigierung und der Darstellung in der Managementoberfläche.

(4) Nicht erfasst vom Geltungsbereich sind rein lokale Datenverarbeitungen auf
dem Endgerät des Beschäftigten, die das Endgerät nachweislich nicht verlassen
(zum Beispiel die rein lokale Pseudonymisierungs- und Redigierungspipeline vor
der Übermittlung; siehe §7 Abs. 5).

---

## §3 Begriffsbestimmungen

Im Sinne dieser Vereinbarung bedeuten:

(1) **Erfassungsstufe A (Tier A) — "Zählerbasierte Erfassung":** das System
überträgt ausschließlich numerische Kennzahlen und technische Metadaten, etwa
Zählerstände für Sitzungen, Modellnamen, Zeitstempel, Tokenzahlen, Kosten sowie
Annahmen oder Ablehnungen von Codevorschlägen. Prompt-Inhalte, Werkzeugeingaben
und Werkzeugausgaben werden nicht übertragen.

(2) **Erfassungsstufe B (Tier B) — "Zähler plus redigierte Hüllen" (Standard):**
zusätzlich zu den Daten der Stufe A werden strukturell redigierte Ereignishüllen
übertragen: Ereignistyp, gehashte Dateipfade, Fehlerklassen, Dauer,
Promptlänge (nicht Inhalt), Zeilenzahl einer Codeänderung (nicht Inhalt). Der
Rohtext eines Prompts oder einer Werkzeugantwort wird nicht übertragen. Diese
Stufe ist der voreingestellte Standard des Systems.

(3) **Erfassungsstufe C (Tier C) — "Vollständige Ereignisse mit Prompttext":**
zusätzlich zu den Daten der Stufe B werden der redigierte Rohtext von Prompts,
Werkzeugergebnissen sowie Dateipfaden und Änderungsinhalten übertragen. Diese
Stufe ist nur unter den Voraussetzungen des §7 Abs. 4 zulässig und darf nicht
als Standard aktiviert werden.

(4) **Redigierte Hülle:** ein Ereignisdatensatz, aus dem vor Versand durch
mehrstufige Erkennungs- und Ersetzungsregeln (serverseitig verbindlich
erzwungen, endgerätseitig als Verteidigung in der Tiefe) sämtliche erkannten
Geheimnisse (API-Schlüssel, Zugangsdaten, Token) sowie personenbezogene
Merkmale Dritter (Namen, E-Mail-Adressen, Ticket-Kennungen) entfernt und durch
deterministische Platzhalter ersetzt wurden.

(5) **AI Leverage Score:** aggregierte Kennzahl, die fünf Teildimensionen
(Outcome Quality, Efficiency, Autonomy, Adoption Depth, Team Impact) gemäß der
in `packages/scoring` hinterlegten, versionierten Berechnungsvorschrift
`ai_leverage_v1` zusammenführt. Der Score wird ausschließlich auf Team- und
Aggregatebene in der Managementoberfläche dargestellt und unterliegt den
Mindestkohortenanforderungen nach §5 Abs. 4. Er wird nicht auf Ebene einzelner
Beschäftigter als Rangliste angezeigt und ist kein Bewertungsinstrument im
Sinne einer Leistungsbeurteilung.

(6) **Maturity Ladder (Reifegradstufen: Aware, Operator, Builder, Architect):**
eine rein individuelle Selbstreflexionsansicht für Beschäftigte in ihrem
persönlichen Coach-Bereich (`/me`). Diese Ansicht ist ausschließlich für die
Beschäftigte oder den Beschäftigten selbst sichtbar. Sie ist **für
Führungskräfte niemals einsehbar** und darf **in keinem Fall** für
Leistungsbeurteilungen, Personalentscheidungen oder sonstige arbeitsrechtliche
Maßnahmen herangezogen werden. Eine automatische Zuordnung zu einer
Reifegradstufe zum Zwecke einer Personalentscheidung ist ausgeschlossen.

(7) **Audit-Protokoll (`audit_log`):** ein datenbankseitig als
"append-only" konfiguriertes Protokoll, das jeden lesenden Zugriff auf
datenbezogene Darstellungsflächen sowie jede Offenlegungsgeste festhält.
Löschungen und Änderungen sind auf Datenbankebene durch Entzug der Rechte
(`REVOKE UPDATE, DELETE`) ausgeschlossen.

(8) **Einsichtsprotokoll (`audit_events`):** ein weiteres Protokoll, das
jeden Aufruf einer individuellen Drill-Down-Seite einer oder eines
Beschäftigten durch eine Führungskraft oder eine administrativ berechtigte
Person zeitgleich mit dem Aufruf festhält. Das Einsichtsprotokoll ist die
technische Grundlage für die Transparenzpflicht nach §6 Abs. 6.

(9) **Egress-Journal:** das lokal auf dem Endgerät geführte Protokoll aller
ausgehenden Übertragungen des Systems. Es ist für die Beschäftigte oder den
Beschäftigten durch den Befehl `devmetrics audit --tail` jederzeit einsehbar.

(10) **Signierte Konfigurationsänderung:** eine Änderung der wirksamen
Erfassungsstufe oder sicherheitsrelevanter Systemparameter, die ausschließlich
durch eine mit einem Ed25519-Schlüssel signierte Konfigurationsdatei wirksam
werden kann.

---

## §4 Zulässige Nutzungszwecke

(1) Das System darf ausschließlich zu den nachstehend abschließend
aufgeführten Zwecken eingesetzt werden:

a) **Kostensteuerung (FinOps):** Auswertung der durch KI-gestützte
   Entwicklungswerkzeuge entstehenden Kosten auf Team- und Organisationsebene,
   insbesondere zur Budgetplanung, Anomalieerkennung übermäßiger Kosten und zur
   Identifikation ineffizienter Nutzungsmuster auf aggregierter Ebene.

b) **Zuverlässigkeits- und Qualitätsauswertung:** Analyse der Zuverlässigkeit
   eingesetzter Werkzeuge (Fehlerraten, Wiederholungsraten, Abbrüche) auf
   Aggregatebene sowie Korrelation mit Git-Ergebnissen (zusammengeführte Pull
   Requests, grüne Testläufe) zur Verbesserung der Werkzeugauswahl und der
   technischen Prozesse.

c) **Team-Aggregatanalyse:** Darstellung kohortenbasierter Muster auf
   Teamebene, ausdrücklich unter Einhaltung der Mindestkohortenanforderungen
   nach §5 Abs. 4.

d) **Aggregierte Auswertung wiederverwendbarer Arbeitsmuster ("Playbooks"),**
   jedoch nur auf ausdrücklichen, widerruflichen Einzelanstoß der oder des
   betreffenden Beschäftigten. Eine automatische Freigabe durch das System ist
   ausgeschlossen.

(2) Jede Nutzung des Systems für einen nicht in Absatz 1 genannten Zweck ist
unzulässig und stellt einen Verstoß gegen diese Vereinbarung dar.

(3) Ausdrücklich ausgeschlossen sind insbesondere:

a) jede **Leistungsbeurteilung** einzelner Beschäftigter auf Grundlage von
   Daten des Systems;

b) jede **Abmahnung, Kündigungsvorbereitung oder disziplinarische Maßnahme,**
   die auf Daten des Systems gestützt wird;

c) jede **Personalentscheidung** (Einstellung, Versetzung, Beförderung,
   Vergütungsentscheidung, Befristungsentscheidung), die auf Daten des Systems
   gestützt wird;

d) jede **Erstellung von Ranglisten, Bestenlisten oder "Schlusslichtlisten"**
   ("bottom-10 %") einzelner Beschäftigter;

e) jede **Echtzeitüberwachung** des laufenden Arbeitsverhaltens einzelner
   Beschäftigter, insbesondere ein Ereignis-Livefeed auf Einzelpersonenebene;

f) jede Nutzung der Daten zu **Zwecken der Intervention oder Blockierung** der
   Arbeit einzelner Beschäftigter in Echtzeit.

(4) Die in Absatz 3 genannten Ausschlüsse sind produktseitig durch die in §6
und §7 beschriebenen technischen Kontrollen und durch die in §9 beschriebenen
Mitwirkungsrechte des Betriebsrats flankiert.

---

## §5 Verbot von Leistungs- und Verhaltenskontrollen

(1) Das System darf nicht zur Leistungs- und Verhaltenskontrolle eingesetzt
werden.

(2) Vom Verbot nach Absatz 1 umfasst sind insbesondere:

a) die Erstellung öffentlicher oder im Führungskräftekreis einsehbarer
   **Ranglisten** einzelner Beschäftigter nach Produktivitäts-, Qualitäts-
   oder Effizienzmerkmalen;

b) die Erstellung von **"Schlusslichtlisten"** oder vergleichbaren
   Darstellungen, die einzelne Beschäftigte als die unteren Rangplätze einer
   Kohorte ausweisen;

c) die Anzeige von **individuellen Leistungswerten** (insbesondere individuelle
   AI-Leverage-Scores) für Führungskräfte; die Managementoberfläche zeigt
   Leistungskennzahlen **ausschließlich auf Aggregatebene** an;

d) die Verwendung von System-Daten als **primäre** oder **alleinige** Grundlage
   einer Personalmaßnahme.

(3) Die Managementoberfläche zeigt in der Standardkonfiguration nur
Darstellungen, die die nachfolgenden Mindestkohortenanforderungen erfüllen.
Wird eine Schwelle unterschritten, wird die betreffende Darstellung
ausgeblendet und durch den Hinweis "Unzureichende Kohorte" ersetzt.

(4) **Mindestkohortenanforderungen (k-Anonymität):**

a) **k ≥ 5** für jede Teamkachel. Eine Teamkachel wird nur angezeigt, wenn die
   ausgewertete Kohorte mindestens fünf Beschäftigte umfasst und wenn das
   Ausscheiden einer oder eines einzelnen Beschäftigten aus der Kohorte
   (zum Beispiel durch Urlaub) den Schwellenwert nicht unterschreiten würde.

b) **k ≥ 3** als Mindestbeitrag für jede Darstellung von Prompt-Clustern. Cluster
   mit weniger als drei beitragenden Beschäftigten werden nicht angezeigt.

c) **k ≥ 25** für differentiell-privat verrauschte Veröffentlichungen ab
   Phase 2 des Systems.

(5) Ein individueller Leistungswert wird nur dann angezeigt, wenn sämtliche
vier nachstehenden Bedingungen erfüllt sind: (a) mindestens zehn Sitzungen,
(b) mindestens fünf aktive Tage, (c) mindestens drei Ergebnisereignisse,
(d) Vergleichskohorte von mindestens acht Peers. Wird eine dieser Bedingungen
unterschritten, wird die betreffende Darstellung ausgeblendet und durch den
Hinweis "Unzureichende Daten" ersetzt. Eine Näherung oder Interpolation ist
ausgeschlossen.

(6) Eine Auswertung auf Einzelpersonenebene ist — vorbehaltlich der in §7
Abs. 4 geregelten Ausnahmen — nur für die oder den betreffenden Beschäftigten
selbst in ihrem oder seinem persönlichen Coach-Bereich zugänglich.
Führungskräfte erhalten ausschließlich aggregierte Darstellungen.

---

## §6 Rechte der Arbeitnehmer

(1) **Recht auf Nicht-Übertragung von Prompt-Inhalten ohne Hinweis.** Der
Rohtext von Prompts, Werkzeugeingaben oder Werkzeugausgaben einer oder eines
Beschäftigten verlässt das Endgerät nur, wenn zuvor ein sichtbarer Hinweis in
der Entwicklungsumgebung der oder des Beschäftigten eingeblendet wurde. In der
Standardkonfiguration (Erfassungsstufe B) verlässt **kein** Rohtext das
Endgerät; es werden ausschließlich redigierte Hüllen und Zähler übertragen.
Jeder ausgehende Datenverkehr ist im lokalen Egress-Journal einsehbar und über
den Befehl `devmetrics audit --tail` durch die oder den Beschäftigten
abrufbar. Das System unterstützt auf dem Endgerät die Beschränkung des
zulässigen Empfängers durch Zertifikatsbindung (`--ingest-only-to`).

(2) **Recht auf Vertraulichkeit gegenüber der Führungskraft.** Führungskräfte
können den Rohtext von Prompts nicht einsehen. Ausnahmen sind ausschließlich
die drei in §7 Abs. 4 genannten, jeweils im Audit-Protokoll erfassten Fälle.
Ein Aufruf der Offenlegungsgeste ("Reveal"), ein CSV-Export mit Prompts sowie
jede Nutzung des "Export with prompts" erfordern technisch eine
Zweifaktor-Authentifizierung und erzeugen je einen Eintrag im Audit-Protokoll.

(3) **Recht auf Einsicht, Export und Löschung.** Jede Beschäftigte und jeder
Beschäftigte hat das Recht, sämtliche über sie oder ihn gespeicherten Daten
einzusehen, in maschinenlesbarer Form zu exportieren (Art. 15, 20 DSGVO) und
löschen zu lassen (Art. 17 DSGVO). Der Arbeitgeber verpflichtet sich zu einer
**Löschungsfrist von sieben Tagen** ab Eingang eines vollständigen Antrags
(kürzer als die gesetzliche Monatsfrist des Art. 12 Abs. 3 DSGVO). Die Löschung
erfolgt durch atomares Löschen der zugehörigen Datenbankpartition (`DROP
PARTITION`) sowie durch Ausführung des Befehls `devmetrics erase`. Die
erfolgreiche Durchführung wird der oder dem Beschäftigten per E-Mail
bestätigt und im Audit-Protokoll erfasst.

(4) **Recht auf Standardeinstellung.** Der voreingestellte Standard des
Systems ist Erfassungsstufe B (Zähler und redigierte Hüllen). Eine Anhebung
auf Erfassungsstufe C ist nur unter den Voraussetzungen des §7 Abs. 4
zulässig.

(5) **Recht auf lückenlose Protokollierung jeder Einsichtnahme.** Jeder
lesende Zugriff einer Führungskraft oder einer administrativ berechtigten
Person auf datenbezogene Darstellungsflächen wird zum Zeitpunkt des Zugriffs
im Audit-Protokoll erfasst. Die oder der Beschäftigte kann eine Kopie der sie
oder ihn betreffenden Einträge jederzeit anfordern, insbesondere über den
Befehl `devmetrics audit --my-accesses`.

(6) **Recht auf Benachrichtigung bei Einsichtnahme durch eine Führungskraft.**
Bei jedem Aufruf einer individuellen Drill-Down-Seite einer oder eines
Beschäftigten durch eine Führungskraft wird zum Zeitpunkt des Aufrufs ein
Eintrag in das Einsichtsprotokoll (`audit_events`) geschrieben. Die oder der
betroffene Beschäftigte erhält hierüber in der Standardkonfiguration eine
**tägliche Zusammenfassung**. Eine Umstellung auf **sofortige
Benachrichtigung** ist im persönlichen Benachrichtigungsbereich (`/me/notifications`)
ohne weitere Begründung möglich. Ein Abbestellen der Benachrichtigung ist
zulässig; die Transparenz ist jedoch als Standard gesetzt. Die
Benachrichtigung nach diesem Absatz ist weder an eine Vergütungsstufe gebunden
noch ein kostenpflichtiges Zusatzmerkmal.

(7) **Recht auf Widerspruch ohne Nachteil.** Eine Beschäftigte oder ein
Beschäftigter, die oder der von ihren oder seinen Rechten nach dieser
Vereinbarung Gebrauch macht (insbesondere Löschung, Widerspruch gegen eine
Aktivierung nach §7 Abs. 4 lit. a), darf hierfür keinen arbeitsrechtlichen,
tätigkeitsbezogenen oder sonstigen Nachteil erleiden.

(8) Die in diesem Paragrafen genannten Rechte entsprechen der "Bill of Rights"
des Systems nach Ziffer 6.5 des Produkt-Anforderungsdokuments (PRD). Eine
Paragraphen-weise Zuordnung zwischen diesen Rechten, den gesetzlichen
Grundlagen und den technischen Kontrollmechanismen enthält die Anlage
`bill-of-rights-rider.md`.

---

## §7 Datenschutz

(1) **Grundsätze der Verarbeitung.** Die Verarbeitung personenbezogener Daten
durch das System erfolgt unter Beachtung der Grundsätze des Art. 5 DSGVO,
insbesondere der Rechtmäßigkeit (Art. 5 Abs. 1 lit. a), der Zweckbindung (lit.
b), der Datenminimierung (lit. c), der Richtigkeit (lit. d), der
Speicherbegrenzung (lit. e) sowie der Integrität und Vertraulichkeit (lit. f).
Die gesetzlichen Grundlagen sind insbesondere § 26 BDSG sowie Art. 6 Abs. 1
lit. b und lit. f DSGVO in Verbindung mit dieser Vereinbarung als
kollektivrechtlicher Erlaubnistatbestand (§ 26 Abs. 4 BDSG, § 87 BetrVG).

(2) **Informationspflichten.** Der Arbeitgeber erfüllt die Informationspflichten
nach Art. 13 DSGVO durch das Bill-of-Rights-Dokument (veröffentlicht unter
`/privacy`), die vorliegende Betriebsvereinbarung sowie eine ergänzende
Mitarbeiterinformation. Die Mitarbeiterinformation enthält insbesondere die
Kategorien verarbeiteter Daten je Erfassungsstufe, die Speicherfristen nach
§8, die Empfänger (einschließlich etwaiger Auftragsverarbeiter) sowie die
Betroffenenrechte und deren Wahrnehmung.

(3) **Betroffenenrechte.** Die Betroffenenrechte nach Art. 15 bis 22 DSGVO
werden gewahrt. Für die Löschung (Art. 17 DSGVO) sowie für die Auskunft (Art.
15 DSGVO) und Datenübertragbarkeit (Art. 20 DSGVO) gilt die verkürzte Frist
nach §6 Abs. 3.

(4) **Zulässigkeit der Erfassungsstufe C.** Eine Verarbeitung nach
Erfassungsstufe C ist nur unter einer der drei nachstehenden, kumulativ zu
protokollierenden Voraussetzungen zulässig:

a) **Individuelle projektbezogene Einwilligung:** die oder der Beschäftigte
   willigt für ein konkretes Projekt ausdrücklich, informiert und jederzeit
   widerruflich in eine Anhebung auf Erfassungsstufe C ein. Der Widerruf
   wirkt unmittelbar.

b) **Mandantenweite Aktivierung durch die Administration:** die Administration
   aktiviert Erfassungsstufe C mandantenweit, wobei sämtliche folgenden
   technischen und organisatorischen Voraussetzungen kumulativ erfüllt sein
   müssen:

   - Die Konfigurationsänderung ist mit einem Ed25519-Schlüssel signiert
     (signierte Mandantenkonfiguration);
   - zwischen Signatur und Wirksamkeit liegt eine **Sperrfrist von sieben
     Tagen** ("Cooldown");
   - jeder betroffenen Beschäftigten und jedem betroffenen Beschäftigten wird
     **vor Wirksamwerden** ein Banner in der Entwicklungsumgebung eingeblendet
     ("In-IDE-Banner"), das über die Aktivierung, den voraussichtlichen
     Wirksamkeitsbeginn sowie die Widerspruchsmöglichkeit informiert;
   - der Betriebsrat wird **vor Beginn der Sperrfrist** schriftlich
     benachrichtigt und erhält Gelegenheit zur Stellungnahme innerhalb der
     Sperrfrist.

c) **Rechtlich begründete Aufbewahrungsanordnung ("Legal-hold"):** eine
   zeitlich befristete, namentlich zugeordnete Aufbewahrungs- oder
   Vorhalteanordnung aus rechtlichen Gründen, die ausschließlich durch eine
   Person mit der Rolle "Auditor" aktiviert werden kann. Die Anordnung ist
   dokumentations- und begründungspflichtig und wird dem Betriebsrat unter
   Wahrung etwaiger gesetzlicher Verschwiegenheitspflichten angezeigt.

(5) **Serverseitige Redigierung.** Die Redigierung der übertragenen
Ereignisse ist serverseitig verbindlich erzwungen. Das System setzt hierfür
mindestens die Werkzeuge TruffleHog, Gitleaks sowie die Presidio-Regelsätze
ein. Erkannte Geheimnisse oder personenbezogene Merkmale Dritter werden durch
deterministische Platzhalter ersetzt. Der endgeräteseitige Redigierungsschritt
ist eine ergänzende Verteidigung in der Tiefe; Maßgebend ist die
serverseitige Durchsetzung. Das System weist bei der Erfassung für die
Erfassungsstufen A und B eine **Zulässigkeitsliste** ("allowlist") für
`raw_attrs`-Felder auf; eine Übertragung nicht zulässiger Felder wird vom
Eingangsdienst mit HTTP-Status 400 zurückgewiesen.

(6) **Pseudonymisierung auf Aggregatebene.** Aggregierte Auswertungen, die
dauerhaft aufbewahrt werden, werden mit einer mandantenspezifischen Schlüssel-
ableitung (`HMAC(engineer_id, tenant_salt)`) pseudonymisiert, sodass eine
mandantenübergreifende Zusammenführung ausgeschlossen ist. Dies ist zugleich
die Grundlage für die unbefristete Aufbewahrung nach Art. 17 Abs. 3 lit. e
DSGVO (statistische Zwecke).

(7) **Datenschutz-Folgenabschätzung (DSFA).** Der Arbeitgeber führt vor
Inbetriebnahme des Systems eine Datenschutz-Folgenabschätzung nach Art. 35
DSGVO durch. Der Betriebsrat sowie die oder der betriebliche
Datenschutzbeauftragte ({{DPO_EMAIL}}) werden angemessen beteiligt. Eine
Vorlage für die DSFA stellt der Hersteller unter `legal/review/DPIA.md`
bereit; die Verantwortung für Inhalt und Durchführung verbleibt beim
Arbeitgeber.

(8) **Drittlandübermittlung.** Soweit im Rahmen des Betriebs des Systems
personenbezogene Daten in Drittländer übermittelt werden (insbesondere bei
Nutzung der verwalteten Cloud-Variante), erfolgt dies ausschließlich auf
Grundlage der Standardvertragsklauseln der Kommission 2021/914 Modul 2 sowie
— soweit anwendbar — der Selbstzertifizierung nach dem EU-US Data Privacy
Framework. Eine Transferfolgenabschätzung (TIA) liegt vor. Eine Vorlage
enthält `legal/review/SCCs-module-2.md`.

(9) **Auftragsverarbeitung.** Die Verarbeitung im Auftrag erfolgt
ausschließlich auf Grundlage eines schriftlichen Auftragsverarbeitungsvertrags
nach Art. 28 DSGVO zwischen Arbeitgeber und Hersteller.

---

## §8 Aufbewahrungsfristen

(1) **Rohereignisse** werden nach folgender Maßgabe gespeichert:

a) **Erfassungsstufe A:** 90 Kalendertage. Die Löschung erfolgt durch atomares
   Partitionslöschen; eine Aufbewahrung mittels TTL-Mechanismus ist
   ausgeschlossen.

b) **Erfassungsstufe B (Standard):** 90 Kalendertage. Die Löschung erfolgt durch
   atomares Partitionslöschen.

c) **Erfassungsstufe C (falls aktiviert):** 30 Kalendertage. Die Löschung kann
   TTL-basiert erfolgen; das atomare Partitionslöschen bleibt im Rahmen der
   Rechte nach §6 Abs. 3 vorrangig.

(2) **Aggregate** (nach dem Rollup gepflegte Auswertungen) werden dauerhaft
aufbewahrt, jedoch ausschließlich in pseudonymisierter Form gemäß §7 Abs. 6.

(3) **Löschantragsbearbeitung.** Ein vollständiger Löschantrag nach §6 Abs. 3
wird innerhalb von sieben Kalendertagen bearbeitet. Die Bearbeitung wird im
Audit-Protokoll erfasst und der antragstellenden Person per E-Mail bestätigt.

(4) **Absturzauszüge (Core-Dumps)** werden nicht angelegt. Die entsprechenden
Ressourcengrenzen (`ulimit -c 0`, `RLIMIT_CORE=0`) sind in der
Systemkonfiguration verbindlich gesetzt.

(5) **Protokolle** (`audit_log`, `audit_events`) werden unbefristet
aufbewahrt, sofern nicht die oder der betroffene Beschäftigte eine Löschung
nach Art. 17 DSGVO geltend macht und nicht überwiegende berechtigte Interessen
(insbesondere Nachweisführung bei Ausübung der Rechte nach §6) entgegenstehen.
Die Aufbewahrung erfolgt in Schreibschutz-Konfiguration (`REVOKE UPDATE,
DELETE` auf Datenbankebene).

---

## §9 Rechte des Betriebsrats

(1) **Transparenz der Einsichtnahmen.** Der Betriebsrat erhält auf Anfrage
aggregierte, anonymisierte Auswertungen aus dem Einsichtsprotokoll
(`audit_events`), aus denen hervorgeht, in welchem Umfang Führungskräfte
individuelle Drill-Down-Seiten aufrufen. Individuelle personenbezogene
Datensätze werden dem Betriebsrat nur insoweit zugänglich gemacht, als die
betroffene Person zugestimmt hat oder die Weitergabe aus Gründen der
kollektiven Rechtewahrnehmung gesetzlich geboten ist.

(2) **Einsicht in Redigierungsprotokolle.** Der Betriebsrat kann in regelmäßigen
Abständen Einsicht in die serverseitigen Redigierungsstatistiken nehmen,
insbesondere in die Anzahl erkannter und ersetzter Geheimnisse, in Auffälligkeiten
der redigierenden Regelsätze sowie in etwaige Fehlalarme.

(3) **Quartalsweise Überprüfung.** Die Parteien führen quartalsweise eine
gemeinsame Überprüfung der Systemnutzung durch. Tagesordnung ist regelmäßig:
die Einhaltung der Nutzungszwecke nach §4, die Einhaltung der Mindestkohorten
nach §5 Abs. 4, die Ausnahmen nach §7 Abs. 4, die Entwicklung der
Löschantragsfristen nach §8 Abs. 3, sowie etwaige Änderungen der
Softwarestände und der Policykonfiguration.

(4) **Vorabunterrichtung.** Der Betriebsrat wird über geplante
Konfigurationsänderungen, die die Erfassungsstufe, die Redigierungsregeln, die
Speicherfristen oder die Managementoberfläche betreffen, rechtzeitig vor deren
Wirksamwerden schriftlich unterrichtet. Die Sperrfrist nach §7 Abs. 4 lit. b
bleibt unberührt.

(5) **Prüfungsrechte.** Der Betriebsrat kann zur Wahrnehmung seiner Aufgaben
im Rahmen dieser Vereinbarung Sachverständige nach § 80 Abs. 3 BetrVG
hinzuziehen. Der Arbeitgeber stellt die hierfür erforderlichen Informationen
und technischen Nachweise (insbesondere zu Quellcode-Verfügbarkeit der
quelloffenen Bestandteile, zu `packages/redact`-Regelsätzen sowie zu
Build-Signaturen nach Sigstore / SLSA Level 3) bereit.

(6) **Zugang zu Roh-Ereignisdaten.** Der Betriebsrat erhält aus Gründen der
Zweckbindung und der Verhältnismäßigkeit keinen Zugang zu Rohereignisdaten
einzelner Beschäftigter. Für kollektivrechtliche Belange werden dem
Betriebsrat aggregierte Auswertungen zur Verfügung gestellt.

---

## §10 Qualifikation und Schulung

(1) Der Arbeitgeber stellt sicher, dass alle Beschäftigten, deren Tätigkeit
vom Geltungsbereich dieser Vereinbarung erfasst ist, vor der produktiven
Erstnutzung des Systems eine dokumentierte Einweisung erhalten. Gegenstand
der Einweisung sind insbesondere:

a) Funktionsweise und Zweck des Systems;

b) Erfassungsstufen und deren Unterschiede (§3 Abs. 1 bis 3);

c) Rechte der oder des Beschäftigten (§6), einschließlich der Bedienung der
   Befehle `devmetrics audit --tail`, `devmetrics erase`, `devmetrics export`;

d) Voreinstellungen und deren Änderungsmöglichkeiten durch die oder den
   Beschäftigten.

(2) Führungskräfte, denen ein Zugriff auf die Managementoberfläche gewährt
wird, erhalten eine vertiefte Einweisung zu den Zweckbindungen nach §4, den
Verbotstatbeständen nach §5 sowie zur Pflicht zur Aufzeichnung jeder
Einsichtnahme.

(3) Die oder der Datenschutzbeauftragte sowie der Betriebsrat werden bei der
Erstellung und Aktualisierung der Schulungsunterlagen beteiligt.

(4) Schulungen finden während der Arbeitszeit statt und werden als
Arbeitszeit vergütet.

---

## §11 Konfliktregelung

(1) Meinungsverschiedenheiten über die Auslegung oder Anwendung dieser
Vereinbarung werden zunächst zwischen Arbeitgeber und Betriebsrat in einem
Eskalationsgespräch zu klären versucht.

(2) Kommt in diesem Rahmen keine Einigung zustande, so wird die oder der
betriebliche Datenschutzbeauftragte ({{DPO_EMAIL}}) sowie, soweit
erforderlich, die zuständige Aufsichtsbehörde sachkundig beteiligt. Eine
gemeinsame Stellungnahme wird innerhalb von 30 Kalendertagen angestrebt.

(3) Führt auch dies nicht zu einer Einigung, so entscheidet auf Antrag einer
Partei eine Einigungsstelle nach § 76 BetrVG. Die Parteien bemühen sich um
eine einvernehmliche Besetzung der Einigungsstelle und einen
Verfahrensbeschleuniger im Rahmen des § 76 Abs. 5 Satz 3 BetrVG.

(4) Für Beanstandungen einzelner Beschäftigter gilt das Beschwerderecht nach
§§ 84, 85 BetrVG; Beanstandungen datenschutzrechtlicher Natur können
zusätzlich bei der oder dem Datenschutzbeauftragten oder der zuständigen
Aufsichtsbehörde vorgebracht werden.

(5) Der Herstellerkontakt für technische Eskalationen ist
{{ESCALATION_CONTACT}}. Die vertragliche Rechtsbeziehung zum Hersteller wird
hierdurch nicht berührt; insbesondere entsteht dem Betriebsrat hierdurch kein
eigener vertraglicher Anspruch gegenüber dem Hersteller.

---

## §12 Inkrafttreten und Kündigung

(1) Diese Betriebsvereinbarung tritt am {{EFFECTIVE_DATE}} in Kraft.

(2) Sie kann von jeder Partei mit einer Frist von **drei Monaten** zum
Monatsende schriftlich gekündigt werden. Eine Kündigung ist erstmals zum Ende
des sechsten Monats nach Inkrafttreten möglich.

(3) Im Falle einer Kündigung gilt diese Vereinbarung gemäß § 77 Abs. 6 BetrVG
bis zum Abschluss einer neuen Vereinbarung in den mitbestimmungspflichtigen
Inhalten fort (Nachwirkung), soweit die mitbestimmungspflichtige
Angelegenheit fortbesteht.

(4) **Datenlöschung nach Beendigung.** Endet der produktive Einsatz des
Systems im Betrieb des Arbeitgebers, werden die im System gespeicherten
personenbezogenen Rohdaten innerhalb von **30 Kalendertagen** nach der
Beendigung gelöscht. Aggregate nach §7 Abs. 6 bleiben pseudonymisiert
erhalten, soweit nicht ein Löschantrag nach §6 Abs. 3 vorliegt. Die Löschung
wird dem Betriebsrat in anonymisierter Form bestätigt.

(5) Änderungen und Ergänzungen dieser Vereinbarung bedürfen der Schriftform.
Dies gilt auch für die Aufhebung des Schriftformerfordernisses selbst.

(6) Sollten einzelne Bestimmungen dieser Vereinbarung unwirksam sein oder
werden, so berührt dies die Wirksamkeit der übrigen Bestimmungen nicht. An die
Stelle der unwirksamen Bestimmung tritt eine Regelung, die dem wirtschaftlich
und rechtlich Gewollten am nächsten kommt.

---

## §13 Unterschriften

Ort, Datum: ____________________________________

**Für den Arbeitgeber:**

{{ARBEITGEBER}}

________________________________________________
(Unterschrift, Name in Druckbuchstaben, Funktion)

**Für den Betriebsrat:**

{{BETRIEBSRAT_VORSITZ}}
Vorsitz des Betriebsrats

________________________________________________
(Unterschrift, Name in Druckbuchstaben)

**Anlagen:**

- Anlage 1: `legal/review/bill-of-rights-rider.md` — Paragraphen-weise
  Zuordnung der Rechte nach §6 zu gesetzlichen Grundlagen und technischen
  Kontrollen.
- Anlage 2: `legal/review/DPIA.md` — Vorlage Datenschutz-Folgenabschätzung.
- Anlage 3: `legal/review/SCCs-module-2.md` — Standardvertragsklauseln
  Modul 2 und Transferfolgenabschätzung (bei Drittlandübermittlung).
- Anlage 4: Mitarbeiterinformation nach Art. 13 DSGVO (durch den Arbeitgeber
  zu erstellen; wird mit dieser Vereinbarung ausgehändigt).

---

<!--
================================================================================
 ENGLISH FOOTER — for Workstream I owner (Sandesh) + DE-qualified counsel
================================================================================

**DE-counsel review checklist (mandatory before execution with any customer).**

1. Verify the BetrVG §87(1) Nr. 6 framing in §1 Abs. 3 against current BAG case law on "geeignet zur Überwachung" (objective-suitability test; intent-irrelevant).
2. Confirm BDSG §26 citations in §7 Abs. 1 remain valid under any post-2026 Beschäftigtendatenschutzgesetz reform.
3. Validate the verbatim prohibition clause in §5 Abs. 1 matches the exact wording used in counsel-reviewed reference Betriebsvereinbarungen (ver.di KI-Muster, betriebsrat-kanzlei Muster-BV). Load-bearing per CLAUDE.md — do not soften.
4. Confirm §6 Abs. 2 (three exceptions) and §7 Abs. 4 (three exceptions) are mutually consistent and match the companion `bill-of-rights-rider.md`.
5. Validate §7 Abs. 4 lit. b (Ed25519 signature + 7-day Sperrfrist + in-IDE banner + Betriebsrat-notification "vor Beginn der Sperrfrist") gives meaningful participation and is not a merely formal notice.
6. Review §8 retention values (90d A, 90d B, 30d C, indefinite pseudonymized aggregates) against current DSK and Landesdatenschutzbehörden guidance; A/B exceed Art. 5(1)(e) floors only by the minimum justifiable margin.
7. Review §9 Abs. 6 (Betriebsrat has no raw individual-event access) against §§ 75, 80 BetrVG; confirm aggregated data suffices for collective representation in this customer's context.
8. Review §11 Abs. 3 (Einigungsstelle per § 76 BetrVG) — confirm it does not inadvertently waive the right on narrower questions.
9. Review §12 Abs. 4 (30-day post-termination deletion) for consistency with Art. 17 DSGVO and any customer-specific HGB / AO archiving obligations.
10. Confirm all placeholders (`{{ARBEITGEBER}}`, `{{BETRIEBSRAT_VORSITZ}}`, `{{EFFECTIVE_DATE}}`, `{{PRODUCTION_VERSION}}`, `{{TENANT_ID}}`, `{{DPO_EMAIL}}`, `{{ESCALATION_CONTACT}}`) are replaced before execution.

**Counsel-priority sections (phrasing authored by non-DE-qualified drafter).**

- §1 Abs. 3 — "unabhängig von der Absicht des Arbeitgebers" follows EDPB Opinion 2/2017; substitute the precise BAG formulation after review.
- §3 Abs. 4 — "redigierte Hülle" is a drafting neologism; counsel to either confirm usability or substitute an Art. 4 Nr. 5 DSGVO "Pseudonymisierung"-anchored term.
- §3 Abs. 10 — "Signierte Konfigurationsänderung" is a product-specific defined term; surrounding phrasing may warrant softening.
- §5 Abs. 2 lit. d — "primäre oder alleinige Grundlage einer Personalmaßnahme"; confirm enforceability as a prohibition clause.
- §6 Abs. 7 — "Widerspruch ohne Nachteil" relative to § 75 BetrVG Maßregelungsverbot; confirm enforceable in arbitration.
- §7 Abs. 1 — Rechtsgrundlagen chain (§ 26 BDSG + Art. 6(1)(b)+(f) DSGVO + this BV as kollektivrechtlicher Erlaubnistatbestand) to be stress-tested against the customer's data-protection regime.
- §7 Abs. 4 lit. b — "vor Beginn der Sperrfrist" formulation: counsel may propose shorter ("Vorlage 7 Tage vor Wirksamkeit") or stronger ("Zustimmungsvorbehalt").
- §8 Abs. 1 lit. a — "atomares Partitionslöschen" is product-shape (DROP PARTITION); confirm it need not be translated into a performance standard ("unverzüglich und unwiederbringlich").
- §9 Abs. 5 — Sigstore / SLSA Level 3 references are product-shape; confirm the § 80 Abs. 3 BetrVG Sachverständiger clause remains workable.
- §12 Abs. 3 — § 77 Abs. 6 BetrVG Nachwirkung; confirm it does not overreach non-mitbestimmungspflichtige matters.

**Changelog.**

- 2026-04-16 — Initial template draft (Sprint 1 Week 1 per compliance PRD §7). Covers BetrVG §87(1) Nr. 6 + BDSG §26 + DSGVO Art. 5/6/13/15/17/20/25/30/35; rights mapped to product controls per CLAUDE.md; verbatim prohibition clause in §5 Abs. 1. Awaiting DE-counsel review per compliance PRD §10.1 (external action E-1).

**Cross-reference.** See `dev-docs/workstreams/i-compliance-prd.md` for the
artifact catalog row (§5), the two-artifact Bill of Rights strategy (§6), and
the ship order (§7). The companion rider — which maps each §6 right to its
statutory citation and product control — lives at
`legal/review/bill-of-rights-rider.md` (forthcoming in same sprint).

================================================================================
-->
