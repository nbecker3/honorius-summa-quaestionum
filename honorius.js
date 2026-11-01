/*
 * Leseansicht der digitalen Edition (Magistri Honorii Summa Quaestionum).
 *
 * Lädt die TEI-Datei, stellt sie mit CETEIcean dar (TEI-Elemente werden zu <tei-…>-Elementen,
 * xml:id wird zur HTML-id) und ergänzt:
 *   - fette Gliederungsformeln, Zeilenumbrüche und Zeilenzahlen wie im Druck
 *   - Allegationen als Links ins Decretum Gratiani online, Blöcke leuchten gemeinsam auf
 *   - je Quaestio den kritischen Apparat und den Quellenapparat (aus @cRef und <note type="fons">)
 *   - Blatt- und Spaltenwechsel von P: Strich im Text, Randmarke "fol. 61ra" mit Link zu Gallica
 *   - Modi "Variants" und "Sources" für den Haupttext: Überfahren/Klick markiert Lemmata (gelb) bzw. Quellen
 *     (rot, Allegationsblock blau); Klick auf einen Apparateintrag markiert sein Lemma bzw. seine Quellenstelle;
 *     "Show lemmata" unterstreicht die größten Lemmata bzw. die Quellenstellen
 *   - Register (Personen mit Verweisformen, Allegationen, Handschriften), Zitiervorschlag
 *   - Parallelansicht: Handschrift P neben dem Text (IIIF-Bilder von Gallica in OpenSeadragon, erst bei
 *     Bedarf geladen); blättert beim Lesen mit, Randmarken blättern zur Seite; "q.N" zeigt die Eingangsfrage in P
 *     (Rahmen aus <zone points>)
 * Oberfläche englisch, Apparat je Quaestio, Lemmata standardmäßig unmarkiert
 * (Entscheidungen des Herausgebers vom 18.10.2026); Parallelansicht mit OpenSeadragon und Mitblättern
 * (Entscheidungen vom 24.10.2026).
 */
"use strict";

const TEI_NS = "http://www.tei-c.org/ns/1.0";

// Gliederungsformeln am Anfang eines Abschnitts (längere zuerst)
const FORMELN = ["Solutio prima", "In secunda", "Et non uidetur", "Et uidetur", "Item queritur",
  "Set queritur", "Queri potest", "Queritur", "Econtra", "Solutio", "Item"];

const QUELLENART = {
  gratian: "Decretum Gratiani", extra: "Decretals / councils", codex: "Codex Iustinianus",
  digesta: "Digest", institutiones: "Institutes", novellae: "Novels", biblia: "Bible",
};

// Kursiv gesetzte Herausgeberwörter im Apparat (wie im Druck)
const KURSIV = /\b(linearum spatium praem\.|supra in lin\.|supra lin\.|et marg\.|rubr\.|marg\.|om\.|add\.|praem\.|forsan|coniecimus|mss\.|cf\.|an\.|Friedb\.)/g;

const zustand = {
  apps: [], lemmaBereiche: [], zeilenVon: null, quaestioAktuell: null, xml: null,
  modus: "varianten",                  // Text-Modus: "varianten" | "quellen" (Schalter unter View)
  lemmata: [], quellen: [],            // Stellen im Text: {art, bereich (Range), laenge, app | el, block | note, teil}
  teilVonRef: new Map(), teilVonNotiz: new Map(),   // Teile des Quellenapparats zu Allegation bzw. Notiz
  schwebend: null,                     // Stelle unter der Maus
};

/*
 * Einstellungen der Ansicht (Lese-/Parallelansicht, Modus, Schalter unter "View") gelten nur für den geöffneten Tab
 * (sessionStorage): Neuladen behält sie, jedes neue Öffnen beginnt mit der Grundeinstellung = Reading view, Variants,
 * "Show lemmata" aus, Zeilenzahlen und Apparat an (Entscheidung des Herausgebers vom 01.11.2026).
 */
const einstellung = {
  lesen(name) { try { return sessionStorage.getItem("honorius-" + name); } catch { return null; } },
  merken(name, wert) { try { sessionStorage.setItem("honorius-" + name, wert); } catch { /* ohne Speicher */ } },
};
// Bis 01.11.2026 dauerhaft im Browser gemerkte Einstellungen entfernen
try {
  for (const name of ["ansicht", "modus", "opt-zeilen", "opt-apparat", "opt-lemmata"]) localStorage.removeItem("honorius-" + name);
} catch { /* ohne Speicher */ }

document.addEventListener("DOMContentLoaded", start);

async function start() {
  if (window.HONORIUS_ZU_ALT) return;   // Browser zu alt, Hinweis steht schon (index.html)
  // ?tei=… nur für Dateien im eigenen Ordner tei/ (sonst könnte ein präparierter Link fremden Inhalt unter der
  // Adresse der Edition anzeigen); alles andere wird übergangen und die Standarddatei (data-tei) geladen
  const gewuenscht = new URLSearchParams(location.search).get("tei");
  const teiUrl = gewuenscht && /^(\.\.\/)?tei\/[A-Za-z0-9_.-]+\.xml$/.test(gewuenscht) ? gewuenscht : document.body.dataset.tei;
  const edition = document.getElementById("edition");
  let html;
  try {
    // Standardverhalten aus (sie würden z.B. jede Allegation zu einem Link auf "dg:…" machen);
    // nur das Kürzel "tei" für den TEI-Namensraum anmelden, damit die Elemente <tei-…> heißen
    const ceteicean = new CETEI({ omitDefaultBehaviors: true });
    ceteicean.addBehaviors({ namespaces: { tei: TEI_NS } });
    html = await ceteicean.getHTML5(teiUrl);
    zustand.xml = ceteicean.XML_dom;
  } catch (fehler) {
    console.error(fehler);
  }
  if (!html || !zustand.xml) {
    edition.innerHTML = location.protocol === "file:"
      ? `<p class="fehler">The edition file <code>${esc(teiUrl)}</code> could not be loaded.
      If you opened this page directly from disk, start a local web server in the project folder
      (e.g. <code>python -m http.server</code>) and open <code>http://localhost:8000/web/</code>.</p>`
      : `<p class="fehler">The edition file could not be loaded. Please check your internet connection and reload the page.</p>`;
    return;
  }
  edition.replaceChildren(html);
  const xml = zustand.xml;
  const erweitere = lesePraefixe(xml);

  kopfdaten(xml, teiUrl);
  formeln(edition);
  zeilen(edition);
  allegationen(edition, erweitere);
  namen(edition, xml);
  faksimile(edition, xml, erweitere);
  spaltenP(edition, xml, erweitere);
  zustand.zeilenVon = zeilenkarte(edition);
  zustand.zeugen = Object.fromEntries(teiKinder(xml, "witness").map((w) => [w.getAttribute("xml:id"), w.textContent.replace(/\s+/g, " ").trim()]));
  zustand.apps = leseApparat(xml);
  apparate(edition, xml, erweitere);
  sammleStellen(edition, xml);
  inhaltsverzeichnis(edition, xml);
  register(edition, xml, erweitere);
  textInteraktion(edition);
  ansichtsoptionen();
  zitieren(xml);
  viewerAnsicht(edition, xml, erweitere);
  randspalte();
  document.fonts?.ready.then(randspalte);   // erst mit geladener Schrift stimmen die Zeilenlängen
  let geplant = false;
  addEventListener("resize", () => {
    if (geplant) return;
    geplant = true;
    requestAnimationFrame(() => { geplant = false; randspalte(); });
  });
  springeZuAnker();
}

/** Folio-Marken von P an den rechten Rand der Textspalte, rechtsbündig unter die Seitenzahlen des Drucks (in
 *  beiden Ansichten gleich). Stieße eine Zeile an die Marke (schmale Fenster, umbrechende Zeilen), bleiben die
 *  Folio-Marken klein hinter dem Strich. */
function randspalte() {
  const edition = nachId("edition");
  const absaetze = edition.querySelectorAll("tei-div[type=quaestio] tei-p");
  if (!absaetze.length) return;
  document.body.classList.add("randmarken");          // messen mit Marken am Rand (nicht im Text)
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
  const spalte = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--textspalte")) * rem;
  const links = absaetze[0].getBoundingClientRect().left;
  const kante = links + Math.min(absaetze[0].clientWidth, spalte);   // rechter Rand wie beim Seitenwechsel des Drucks
  let rechts = links;
  const filter = { acceptNode: (n) => n.parentElement.closest(".zeilennummer, .folio-marke") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT };
  const r = document.createRange();
  for (const p of absaetze) {
    const gang = document.createTreeWalker(p, NodeFilter.SHOW_TEXT, filter);
    for (let n = gang.nextNode(); n; n = gang.nextNode()) {
      r.selectNodeContents(n);
      for (const box of r.getClientRects()) if (box.width) rechts = Math.max(rechts, box.right);
    }
  }
  const breite = Math.max(3.5 * rem, ...Array.from(edition.querySelectorAll(".folio-marke"), (m) => m.offsetWidth));
  document.body.classList.toggle("randmarken", rechts + rem + breite <= kante);   // mindestens 1rem Luft
}

/* ---------------------------------------------------------------- Hilfen */

function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

function teiKinder(el, name) {
  return Array.from(el.getElementsByTagNameNS(TEI_NS, name));
}

/** Präfixe aus <listPrefixDef> ("dg:1_1080" -> volle Adresse) */
function lesePraefixe(xml) {
  const defs = {};
  for (const p of teiKinder(xml, "prefixDef")) {
    defs[p.getAttribute("ident")] = {
      muster: new RegExp("^" + p.getAttribute("matchPattern") + "$"),
      ersatz: p.getAttribute("replacementPattern"),
    };
  }
  return (uri) => {
    const m = /^([a-z][a-z0-9+.-]*):(.*)$/.exec(uri || "");
    return m && defs[m[1]] ? m[2].replace(defs[m[1]].muster, defs[m[1]].ersatz) : uri;
  };
}

/** Textknoten eines Elements mit fortlaufenden Positionen (ohne Label, Zeilenzahlen und Marken von P) */
function textKnoten(wurzel) {
  const filter = { acceptNode: (n) => n.parentElement.closest("tei-label, .zeilennummer, .spaltenwechsel, .folio-marke") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT };
  const gang = document.createTreeWalker(wurzel, NodeFilter.SHOW_TEXT, filter);
  const liste = [];
  let pos = 0;
  for (let n = gang.nextNode(); n; n = gang.nextNode()) {
    liste.push({ knoten: n, von: pos });
    pos += n.data.length;
  }
  return { liste, text: liste.map((x) => x.knoten.data).join("") };
}

function bereichAus(info, von, bis) {
  const stelle = (pos, ende) => {
    for (const x of info.liste) {
      const l = x.knoten.data.length;
      if (pos < x.von + l || (ende && pos === x.von + l)) return [x.knoten, pos - x.von];
    }
    const letzter = info.liste[info.liste.length - 1].knoten;
    return [letzter, letzter.data.length];
  };
  const r = document.createRange();
  r.setStart(...stelle(von, false));
  r.setEnd(...stelle(bis, true));
  return r;
}

function umhuelle(bereich, klasse) {
  const span = document.createElement("span");
  span.className = klasse;
  span.appendChild(bereich.extractContents());
  bereich.insertNode(span);
  return span;
}

/* ---------------------------------------------------------------- Kopf, Text */

function kopfdaten(xml, teiUrl) {
  const kopf = xml.querySelector("titleStmt > title")?.textContent || "";
  document.title = kopf.replace(/^Magistri Honorii /, "Honorius, ");
  const titulus = xml.querySelector("div[type=titulus] > head");
  const datum = xml.querySelector("revisionDesc change")?.getAttribute("when") || "";
  zustand.stand = datum;
  const titulusText = titulus ? titulus.textContent.replace(/\s+/g, " ").trim() : "";
  // Titelleiste ohne "working draft" und Datum (Wunsch des Herausgebers vom 24.10.2026); das Datum steht im Zitiervorschlag
  document.getElementById("stand").textContent = `${titulusText} · Digital edition`;
  const tei = document.getElementById("verweis-tei");
  tei.href = teiUrl;
  tei.setAttribute("download", teiUrl.split("/").pop());
}

/** Gliederungsformeln fett wie im Druck (die TEI-Datei zeichnet sie nicht aus) */
function formeln(edition) {
  const muster = new RegExp("^\\s*(" + FORMELN.join("|") + ")\\b");
  for (const div of edition.querySelectorAll("tei-div[type=queritur], tei-div[type=videtur], tei-div[type=econtra], tei-div[type=solutio]")) {
    const p = div.querySelector("tei-p");
    if (!p) continue;
    const info = textKnoten(p);
    const m = muster.exec(info.text);
    if (!m) continue;
    const von = m.index + m[0].length - m[1].length;
    umhuelle(bereichAus(info, von, von + m[1].length), "formel");
    // "Item posito … queritur …", "Item de … solet queri …": auch das Verb steht im Druck fett
    if (div.getAttribute("type") === "queritur" && m[1] === "Item") {
      const info2 = textKnoten(p);
      const m2 = /\b(queritur|solet queri)\b/.exec(info2.text);
      if (m2) umhuelle(bereichAus(info2, m2.index, m2.index + m2[1].length), "formel");
    }
  }
}

/** Zeilenumbruch und Zeilenzahl an jedem <lb>; bei break="no" Trennstrich wie im Druck */
function zeilen(edition) {
  for (const lb of edition.querySelectorAll("tei-body tei-lb")) {
    const n = Number(lb.getAttribute("n"));
    const absatz = lb.closest("tei-p, tei-head");
    if (absatz) {
      const vorher = document.createRange();
      vorher.setStart(absatz, 0);
      vorher.setEndBefore(lb);
      if (vorher.toString().trim() !== "") {
        if (lb.getAttribute("break") === "no") lb.before(document.createTextNode("-"));
        lb.before(document.createElement("br"));
      }
    }
    const nr = document.createElement("span");
    nr.className = "zeilennummer" + (n % 5 === 0 ? " fuenf" : "");
    nr.id = "line-" + n;
    nr.textContent = n;
    lb.appendChild(nr);
  }
}

/** Element -> {start, ende}: Zeilen, in denen ein Element beginnt und endet */
function zeilenkarte(edition) {
  const karte = new Map();
  let zeile = 0;
  const lauf = (el) => {
    if (el.localName === "tei-lb") zeile = Number(el.getAttribute("n"));
    const start = zeile;
    for (const kind of el.children) lauf(kind);
    karte.set(el, { start, ende: zeile });
  };
  lauf(edition.querySelector("tei-body"));
  return karte;
}

function zeilenAngabe(el) {
  const z = zustand.zeilenVon.get(el);
  if (!z) return "";
  return z.start === z.ende ? String(z.start) : `${z.start}-${z.ende}`;
}

/* ---------------------------------------------------------------- Allegationen, Namen, Faksimile */

function allegationen(edition, erweitere) {
  for (const ref of edition.querySelectorAll("tei-body tei-ref[type=allegation]")) {
    const cref = ref.getAttribute("cref");
    const art = ref.getAttribute("subtype");
    const ziele = (ref.getAttribute("target") || "").split(/\s+/).filter(Boolean).map(erweitere);
    const titel = `${QUELLENART[art] || art}: ${cref}` + (ziele.length ? " – opens the Decretum Gratiani online" : "");
    if (ziele.length) {
      const a = document.createElement("a");
      a.href = ziele[0];
      a.target = "_blank";
      a.rel = "noopener";
      a.title = titel;
      a.append(...ref.childNodes);
      ref.appendChild(a);
      ref.classList.add("verlinkt");
    } else {
      ref.title = titel;
      ref.tabIndex = 0;
    }
    // Block beim Überfahren hervorheben: sonst über die Highlight-Markierungen (textInteraktion), hier nur
    // für Browser ohne diese Technik
    const block = ref.closest("tei-seg[type=allegationes]");
    if (block && !hatHighlights) {
      ref.addEventListener("mouseenter", () => block.classList.add("hervor"));
      ref.addEventListener("mouseleave", () => block.classList.remove("hervor"));
      ref.addEventListener("focusin", () => block.classList.add("hervor"));
      ref.addEventListener("focusout", () => block.classList.remove("hervor"));
    }
  }
}

function registerNamen(xml) {
  const namen = {};
  for (const p of teiKinder(xml, "person")) {
    const haupt = teiKinder(p, "persName").find((n) => !n.getAttribute("type"));
    namen[p.getAttribute("xml:id")] = haupt ? haupt.textContent.trim() : p.getAttribute("xml:id");
  }
  return namen;
}

function namen(edition, xml) {
  const reg = registerNamen(xml);
  for (const n of edition.querySelectorAll("tei-body tei-persname")) {
    const id = (n.getAttribute("ref") || "").replace(/^#/, "");
    if (id) {
      n.title = `${reg[id] || id} – see index of persons`;
      // Sprung ins Register nur im Sources-Modus und nur, wenn der Name nicht selbst Quellenstelle ist
      // (dann zeigt ein Klick die Quellennotiz); im Variants-Modus markiert ein Klick das Lemma
      n.addEventListener("click", () => {
        if (zustand.modus !== "quellen" || n.dataset.quelle) return;
        document.getElementById("reg-" + id)?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    } else {
      n.title = "Siglum not resolved (see source apparatus)";
    }
  }
  for (const n of edition.querySelectorAll("tei-body tei-name[type=divine]")) n.title = "Nomen sacrum";
}

function flaecheVon(xml, verweis) {
  const id = (verweis || "").replace(/^#/, "");
  return teiKinder(xml, "surface").find((s) => s.getAttribute("xml:id") === id) || null;
}

/** Adresse der Seite im Gallica-Viewer (<graphic type="viewer">) */
function ansichtVon(flaeche, erweitere) {
  const ansicht = teiKinder(flaeche, "graphic").find((g) => g.getAttribute("type") === "viewer") || teiKinder(flaeche, "graphic")[0];
  return ansicht ? erweitere(ansicht.getAttribute("url")) : "";
}

function faksimile(edition, xml, erweitere) {
  for (const div of edition.querySelectorAll("tei-div[facs]")) {
    const flaeche = flaecheVon(xml, div.getAttribute("facs"));
    if (!flaeche) continue;
    // Spalte, in der der Titulus in P beginnt (<cb ed="#P"> vor der Überschrift), sonst nur das Blatt
    const spalte = div.querySelector(':scope > tei-cb[ed="#P"]')?.getAttribute("n") || flaeche.getAttribute("n") || "";
    const a = document.createElement("a");
    a.className = "faksimile";
    a.href = ansichtVon(flaeche, erweitere);
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = `MS P (BnF lat. 14591), fol. ${spalte} ↗`;
    div.querySelector(":scope > tei-head")?.appendChild(a);
  }
}

/** Blatt- und Spaltenwechsel von P: senkrechter Strich im Text, Randmarke "fol. 61ra" mit Link zu Gallica */
function spaltenP(edition, xml, erweitere) {
  let flaeche = null;   // Seite von P, auf der der Text gerade steht
  for (const el of edition.querySelectorAll('tei-body tei-pb[ed="#P"], tei-body tei-cb[ed="#P"]')) {
    if (el.localName === "tei-pb") { flaeche = flaecheVon(xml, el.getAttribute("facs")); continue; }
    if (!el.closest("tei-p")) continue;   // Anfang des Titulus: steht in der Titelzeile
    const spalte = el.getAttribute("n");
    const strich = document.createElement("span");
    strich.className = "spaltenwechsel";
    strich.textContent = "|";
    strich.title = `MS P: fol. ${spalte} begins here`;
    const marke = document.createElement("a");
    marke.className = "folio-marke";
    marke.textContent = `fol. ${spalte}`;
    marke.dataset.spalte = spalte;
    if (flaeche) {
      strich.dataset.flaeche = marke.dataset.flaeche = flaeche.getAttribute("xml:id");   // für die Parallelansicht
      marke.href = ansichtVon(flaeche, erweitere);
      marke.target = "_blank";
      marke.rel = "noopener noreferrer";
      marke.title = `Open fol. ${flaeche.getAttribute("n")} of MS P in Gallica`;
    }
    el.after(strich, marke);
  }
}

/* ---------------------------------------------------------------- Apparate */

function leseApparat(xml) {
  return teiKinder(xml, "app").map((app) => ({
    el: app,
    von: app.getAttribute("from").slice(1),
    bis: app.getAttribute("to").slice(1),
    n: app.getAttribute("n"),
    korrekturen: Array.from(app.childNodes).filter((k) => k.nodeType === Node.COMMENT_NODE && /Druck:/.test(k.data)).map((k) => k.data.trim()),
  }));
}

/** Sigel wie im Druck ("PLaZ"); als HTML mit der Handschrift als Hinweistext beim Überfahren */
function sigel(wit) {
  return (wit || "").split(/\s+/).filter(Boolean).map((w) => w.replace(/^#/, "")).join("");
}
function sigelHtml(wit) {
  return (wit || "").split(/\s+/).filter(Boolean).map((w) => {
    const s = w.replace(/^#/, "");
    return zustand.zeugen[s] ? `<abbr title="${esc(s + " = " + zustand.zeugen[s])}">${esc(s)}</abbr>` : esc(s);
  }).join("");
}

/** Inhalt eines Apparat-Elements als HTML, ohne <note>; <hi rend="superscript"> -> <sup> */
function inhaltHtml(el) {
  let html = "";
  for (const k of el.childNodes) {
    if (k.nodeType === Node.TEXT_NODE) html += esc(k.data);
    else if (k.nodeType === Node.ELEMENT_NODE && k.localName !== "note") {
      html += k.localName === "hi" && k.getAttribute("rend") === "superscript" ? `<sup>${inhaltHtml(k)}</sup>` : inhaltHtml(k);
    }
  }
  return html.replace(/\s+/g, " ").trim();
}

function textOhneNoten(el) {
  const d = document.createElement("div");
  d.innerHTML = inhaltHtml(el);
  return d.textContent;
}

function notenVon(el) {
  return Array.from(el.children).filter((k) => k.localName === "note").map((k) => k.textContent.replace(/\s+/g, " ").trim());
}

function kursiv(text) {
  return esc(text).replace(KURSIV, "<i>$1</i>").replace(/fol\. (\d+)([rv][ab]?)\b/g, "fol. $1<sup>$2</sup>");
}

function lesartHtml(r, lemmaDruck) {
  const lemma = lemmaDruck.replace(/[¹²³⁰-⁹]/g, "");   // "non²" -> "non"
  const wit = sigel(r.getAttribute("wit"));
  const witHtml = sigelHtml(r.getAttribute("wit"));
  const typ = r.getAttribute("type");
  if (r.localName === "witDetail") {
    const text = textOhneNoten(r);
    if (typ === "marg" && text.trim() === "marg.") return `<i>marg.</i> ${witHtml}`;
    const html = kursiv(text).replace(/P(\d)\b/, "P<sup>$1</sup>").replace(/P²/, "P<sup>2</sup>");
    return text.includes(wit) ? html : `${html} ${witHtml}`;
  }
  if (typ === "om") return `<i>om.</i> ${witHtml}`;
  const noten = notenVon(r);
  // Ort in der Handschrift mit Blattangabe wie im Druck: "De simonia marg. P fol. 60vb",
  // "De symonia supra in lin. (rubr.) et marg. D fol. 14rb" (TEI: Lesart mit <note>marg. fol. 60vb</note>)
  const ORT = String.raw`(?:supra in lin\.|\(rubr\.\)|et marg\.|marg\.)`;
  const ort = noten.length === 1 && new RegExp(String.raw`^(${ORT}(?:\s+${ORT})*)\s+(fol\.\s*\d+[rv][ab]?)$`).exec(noten[0]);
  if (ort) return `${inhaltHtml(r)} ${kursiv(ort[1])} ${witHtml} ${kursiv(ort[2])}`;
  if (typ === "add" && noten.some((n) => n.includes(wit))) return kursiv(noten.join("; ")).replace(/P2\b|P²/, "P<sup>2</sup>");
  let text = inhaltHtml(r);
  const rein = textOhneNoten(r).trim();
  if (typ === "add" && rein.startsWith(lemma + " ")) text = esc(rein.slice(lemma.length + 1));
  if (typ === "praem" && rein.endsWith(" " + lemma)) text = esc(rein.slice(0, -lemma.length - 1));
  let html = text;
  if (typ === "add") html += " <i>add.</i>";
  if (typ === "praem") html += " <i>praem.</i>";
  const nurMss = noten.length === 1 && noten[0] === "mss.";
  if (noten.length && !nurMss) html += " (" + noten.map(kursiv).join("; ") + ")";
  html += nurMss ? " <i>mss.</i>" : ` ${witHtml}${typ === "pc" ? "<sup>pc</sup>" : ""}`;
  return html;
}

/** Lesartengruppe (<rdgGrp>) wie im Druck: gemeinsamer Wortlaut, die Untervariante als Klammer an ihrer Stelle,
 *  Sigel zusammen ("potest quod gratia (gratis praem. B) confertur ZB", Entscheidung vom 25.10.2026).
 *  Lässt sich die Untervariante nicht als Einfügung fassen: null (dann einzeln wie bisher). */
function gruppeHtml(grp) {
  const rdgs = Array.from(grp.children).filter((x) => x.localName === "rdg");
  const basis = rdgs.find((r) => !notenVon(r).length) || rdgs[0];
  const woerter = textOhneNoten(basis).trim().split(/\s+/);
  const ergebnis = woerter.map(esc);
  for (const r of rdgs.filter((x) => x !== basis)) {
    const noten = notenVon(r);
    const andere = textOhneNoten(r).trim().split(/\s+/);
    let vorn = 0;
    while (vorn < woerter.length && woerter[vorn] === andere[vorn]) vorn++;
    let hinten = 0;
    while (hinten < woerter.length - vorn && woerter[woerter.length - 1 - hinten] === andere[andere.length - 1 - hinten]) hinten++;
    if (noten.length !== 1 || andere.length <= woerter.length || vorn + hinten !== woerter.length) return null;
    // praem.: Klammer nach dem Wort, vor das der Zusatz tritt; sonst (add.) nach dem vorangehenden Wort
    const nach = /praem\./.test(noten[0]) ? vorn : vorn - 1;
    if (nach < 0 || nach >= woerter.length) return null;
    ergebnis[nach] += ` (${kursiv(noten[0])})`;
  }
  return `${ergebnis.join(" ")} ${rdgs.map((r) => sigelHtml(r.getAttribute("wit"))).join("")}`;
}

/** Ein Apparateintrag in der Form des Drucks ("7-8 ut – gratia¹ om. Z") */
function eintragHtml(app) {
  const lem = teiKinder(app.el, "lem")[0];
  const lesarten = [];
  for (const k of app.el.children) {
    if (k.localName === "rdg" || k.localName === "witDetail" || k.localName === "rdgGrp") lesarten.push(k);
  }
  const lemHtml = inhaltHtml(lem);
  const lemma = textOhneNoten(lem).trim();
  const lemNoten = notenVon(lem);
  const teile = lesarten.map((r) => r.localName !== "rdgGrp" ? lesartHtml(r, lemma)
    : gruppeHtml(r) ?? Array.from(r.children).filter((x) => x.localName === "rdg").map((x) => lesartHtml(x, lemma)).join(", "));
  let html;
  if (app.n === "tit.") html = teile.join(", ");
  else if (lem.getAttribute("wit")) html = `${lemHtml} ${sigelHtml(lem.getAttribute("wit"))}` + teile.map((t) => ", " + t).join("");
  else if (lem.getAttribute("type") === "coniectura") html = `${lemHtml}] ${kursiv(lemNoten.join(", "))}` + teile.map((t) => ", " + t).join("");
  else if (lemNoten.length) html = `${lemHtml} ${lemNoten.map(kursiv).join(", ")}` + teile.map((t) => ", " + t).join("");
  else if (lesarten.length === 1 && (lesarten[0].localName === "witDetail" || lesarten[0].getAttribute("type") === "om")) html = `${lemHtml} ${teile[0]}`;
  else html = `${lemHtml}] ${teile.join(", ")}`;
  const korr = app.korrekturen.length
    ? `<span class="korrektur" title="Corrected against the printed edition: ${esc(app.korrekturen.join(" "))}">*</span>` : "";
  return `<span class="z">${esc(app.n)}</span>${html}${korr}`;
}

function lemmaBereich(app) {
  const a = document.getElementById(app.von), b = document.getElementById(app.bis);
  if (!a || !b) return null;
  const r = document.createRange();
  r.setStartAfter(a);
  r.setEndBefore(b);
  return r;
}

function quaestioVon(el) {
  return el?.closest("tei-div[type=quaestio]") || null;
}

function apparatBlock(teile, klasse) {
  const block = document.createElement("section");
  block.className = "apparate" + (klasse ? " " + klasse : "");
  for (const [titel, art, eintraege] of teile) {
    if (!eintraege.length) continue;
    const teil = document.createElement("div");
    teil.className = "apparat-teil " + art;
    teil.innerHTML = `<p class="apparat-titel">${titel}</p>`;
    for (const e of eintraege) teil.appendChild(e);
    block.appendChild(teil);
  }
  return block;
}

function eintragElement(app) {
  const span = document.createElement("span");
  span.className = "eintrag";
  span.innerHTML = eintragHtml(app);
  span.tabIndex = 0;
  span.setAttribute("role", "button");
  span.addEventListener("click", (ev) => { ev.stopPropagation(); aktiviere(app, span); });
  span.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); aktiviere(app, span); } });
  app.element = span;
  return span;
}

/** Quellenapparat einer Quaestio: Allegationen (aus @cRef) und Quellennotizen. Reihenfolge wie im Druck: nach der
 *  ersten Zeile, bei gleicher Zeile nach der Stelle im Text; alle Angaben mit derselben Zeilenzahl bilden einen
 *  Eintrag ("81 Secundum S. cf. Weigand …; D.50 c.37"). */
function quellenEintraege(div, xml, erweitere) {
  const xmlRefs = new Map(teiKinder(xml, "ref").filter((r) => r.getAttribute("xml:id")).map((r) => [r.getAttribute("xml:id"), r]));
  // Jeder Eintrag besteht aus Teilen (je Allegation bzw. Block und je Notiz), damit sich eine einzelne
  // Quelle markieren lässt; zustand.teilVonRef / teilVonNotiz verbinden Text und Apparat.
  // posten: {zeilen, ort (Element im Text, für die Reihenfolge), teil}
  const posten = [];
  const gesehen = new Set();
  for (const ref of div.querySelectorAll("tei-ref[type=allegation]")) {
    const block = ref.closest("tei-seg[type=allegationes][n]");
    if (block) {
      if (gesehen.has(block)) continue;
      gesehen.add(block);
      const ersterLink = block.querySelector("tei-ref a")?.href;
      const text = esc(block.getAttribute("n"));
      posten.push({ zeilen: zeilenAngabe(block), ort: block, teil: { refs: Array.from(block.querySelectorAll("tei-ref[type=allegation]")),
        html: ersterLink ? `<a href="${esc(ersterLink)}" target="_blank" rel="noopener">${text}</a>` : text } });
      continue;
    }
    const cref = ref.getAttribute("cref");
    const link = ref.querySelector(":scope > a")?.href;
    const verweis = (t) => link ? `<a href="${esc(link)}" target="_blank" rel="noopener">${esc(t)}</a>` : esc(t);
    const wortlaut = ref.getAttribute("n");   // Wortlaut des Druckapparats, wo er abweicht (Entscheidung vom 25.10.2026)
    let html;
    if (wortlaut) {
      // Link auf die Stellenangabe im Wortlaut ("capitulum illud ꝯ· sc. C.23 q.4 c.53"), sonst auf den ganzen Wortlaut
      const i = wortlaut.lastIndexOf(cref);
      html = i >= 0 ? esc(wortlaut.slice(0, i)) + verweis(cref) + esc(wortlaut.slice(i + cref.length)) : verweis(wortlaut);
    } else if (ref.getAttribute("rend") === "signum") {
      const zeichen = xmlRefs.get(ref.id)?.textContent.trim() || "";
      html = `${esc(zeichen)} sc. ${verweis(cref)}`;
    } else {
      html = verweis(cref);
    }
    posten.push({ zeilen: zeilenAngabe(ref), ort: ref, teil: { refs: [ref], html } });
  }
  for (const note of teiKinder(xml, "note").filter((n) => n.getAttribute("type") === "fons")) {
    const ort = document.getElementById((note.getAttribute("target") || "").split(/\s+/)[0].replace(/^#/, ""));
    if (!ort || quaestioVon(ort) !== div) continue;
    posten.push({ zeilen: note.getAttribute("n") || "", ort, teil: { note, html: notizHtml(note, erweitere) } });
  }
  const erste = (z) => parseInt(z, 10) || 0;
  const imText = (a, b) => (a === b ? 0 : a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
  posten.sort((a, b) => erste(a.zeilen) - erste(b.zeilen) || imText(a.ort, b.ort));
  // Angaben mit derselben Zeilenzahl zu einem Eintrag zusammenfassen (wie im Druck)
  const zusammen = [];
  const nachZeilen = new Map();
  for (const p of posten) {
    let e = nachZeilen.get(p.zeilen);
    if (!e) { e = { zeilen: p.zeilen, teile: [] }; nachZeilen.set(p.zeilen, e); zusammen.push(e); }
    e.teile.push(p.teil);
  }
  return zusammen.map((p) => {
    const span = document.createElement("span");
    span.className = "eintrag";
    span.innerHTML = `<span class="z">${esc(p.zeilen)}</span>`;
    p.teile.forEach((t, i) => {
      if (i) span.append("; ");
      const teil = document.createElement("span");
      teil.className = "teil" + (t.note ? " notiz" : "");
      teil.innerHTML = t.html;
      span.append(teil);
      if (t.note) zustand.teilVonNotiz.set(t.note, teil);
      for (const ref of t.refs || []) zustand.teilVonRef.set(ref, teil);
    });
    return span;
  });
}

function notizHtml(note, erweitere) {
  let html = "";
  for (const k of note.childNodes) {
    if (k.nodeType === Node.TEXT_NODE) html += esc(k.data);
    else if (k.localName === "ref") {
      const ziel = (k.getAttribute("target") || "").split(/\s+/)[0];
      html += ziel ? `<a href="${esc(erweitere(ziel))}" target="_blank" rel="noopener">${esc(k.textContent)}</a>` : esc(k.textContent);
    } else html += esc(k.textContent);
  }
  return html.replace(/\s+/g, " ").trim();
}

function apparate(edition, xml, erweitere) {
  // Titeleintrag unter der Überschrift des Titulus
  for (const div of edition.querySelectorAll("tei-div[type=titulus]")) {
    const titelApps = zustand.apps.filter((a) => div.querySelector(":scope > tei-head")?.contains(document.getElementById(a.von)));
    if (titelApps.length) {
      div.querySelector(":scope > tei-head").after(apparatBlock([["Critical apparatus · title", "ac", titelApps.map(eintragElement)]], "titel"));
    }
  }
  for (const div of edition.querySelectorAll("tei-div[type=quaestio]")) {
    const n = div.getAttribute("n");
    const ac = zustand.apps.filter((a) => quaestioVon(document.getElementById(a.von)) === div).map(eintragElement);
    const af = quellenEintraege(div, xml, erweitere);
    div.appendChild(apparatBlock([[`Critical apparatus · q.${n}`, "ac", ac], [`Sources · q.${n}`, "af", af]]));
  }
  zustand.lemmaBereiche = zustand.apps.map((a) => [a, lemmaBereich(a)]).filter(([, r]) => r && !r.collapsed);
}

/* ---------------------------------------------------------------- Markierungen im Text: Varianten und Quellen */
/*
 * Zwei Modi für den Haupttext (Entscheidungen des Herausgebers vom 24.10.2026):
 *   Variants: Überfahren markiert das kleinste Lemma an dieser Stelle blassgelb, Klick markiert Lemma und Eintrag
 *             im kritischen Apparat gelb und zeigt den Eintrag im kleinen Fenster; Allegationen reagieren nicht.
 *   Sources:  Überfahren einer Allegation hellrot (ihr Block hellblau), Klick öffnet sie; andere Quellenstellen
 *             (Ziele der Quellennotizen) hellrot, Klick markiert Stelle und Notiz kräftig rot (kleines Fenster).
 * Die Apparate bleiben in beiden Modi bedienbar. "Show lemmata" unterstreicht je nach Modus die größten Lemmata
 * bzw. die Quellenstellen. Gelb = Varianten, Rot = Quellen, Blau = Allegationsblock; im Sources-Modus liegen
 * Rot und Blau über Gelb (Vorrang der Quellen).
 */

const hatHighlights = typeof CSS !== "undefined" && CSS.highlights && typeof Highlight !== "undefined";
const VORRANG = { linien: 0, "lemma-hover": 1, "lemma-aktiv": 2, "block-hover": 3, "quelle-hover": 4, "quelle-aktiv": 5 };

function setzeHighlight(name, bereiche) {
  if (!hatHighlights) return;
  if (!bereiche.length) { CSS.highlights.delete(name); return; }
  const h = new Highlight(...bereiche);
  h.priority = VORRANG[name];
  CSS.highlights.set(name, h);
}

function bereichVon(el) {
  const r = document.createRange();
  r.selectNodeContents(el);
  return r;
}

/** Stellen im Text sammeln: Lemmata (kritischer Apparat) und Quellen (Allegationen, Ziele der Quellennotizen) */
function sammleStellen(edition, xml) {
  zustand.lemmata = zustand.lemmaBereiche.map(([app, r]) => ({ art: "lemma", app, bereich: r, laenge: r.toString().length }));
  const quellen = [];
  for (const ref of edition.querySelectorAll("tei-body tei-ref[type=allegation]")) {
    const r = bereichVon(ref);
    quellen.push({ art: "allegation", el: ref, block: ref.closest("tei-seg[type=allegationes]"), bereich: r,
      laenge: r.toString().length, teil: zustand.teilVonRef.get(ref) });
  }
  for (const note of teiKinder(xml, "note").filter((n) => n.getAttribute("type") === "fons")) {
    const anfaenge = (note.getAttribute("target") || "").split(/\s+/).filter(Boolean);
    const enden = (note.getAttribute("targetEnd") || "").split(/\s+/).filter(Boolean);
    anfaenge.forEach((ziel, i) => {
      const a = document.getElementById(ziel.slice(1));
      const b = enden[i] && document.getElementById(enden[i].slice(1));
      if (!a || (enden[i] && !b)) return;
      let r;
      if (b) { r = document.createRange(); r.setStartAfter(a); r.setEndBefore(b); }
      else { r = bereichVon(a); a.dataset.quelle = "1"; }   // z.B. Personenname: Klick zeigt die Notiz
      if (!r.collapsed) quellen.push({ art: "notiz", note, bereich: r, laenge: r.toString().length, teil: zustand.teilVonNotiz.get(note) });
    });
  }
  zustand.quellen = quellen;
  // Teile des Quellenapparats: Notiz anklicken markiert ihre Stelle(n) im Text
  for (const [note, teil] of zustand.teilVonNotiz) {
    teil.tabIndex = 0;
    teil.setAttribute("role", "button");
    const los = (ev) => { ev.stopPropagation(); aktiviereQuelle(quellen.find((q) => q.note === note), true); };
    teil.addEventListener("click", los);
    teil.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); los(ev); } });
  }
}

function sichtbarMachen(r) {
  const box = r.getBoundingClientRect();
  const oben = typeof textOben === "function" ? textOben() : 90;
  if (box.top < oben + 10 || box.bottom > innerHeight - 40) window.scrollBy({ top: box.top - oben - (innerHeight - oben) / 3, behavior: "smooth" });
}

/** Lemma stark markieren (Text und Eintrag im kritischen Apparat) */
function aktiviere(app, eintrag) {
  hebeAuf();
  (eintrag || app.element)?.classList.add("aktiv");
  app.element?.classList.add("aktiv");
  const r = lemmaBereich(app);
  if (!r) return;
  if (hatHighlights) setzeHighlight("lemma-aktiv", [r]);
  else { const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
  sichtbarMachen(r);
}

/** Quellenstelle stark markieren (Text und Teil des Quellenapparats); vomApparat: Stelle ins Bild holen */
function aktiviereQuelle(stelle, vomApparat) {
  if (!stelle) return;
  hebeAuf();
  const bereiche = stelle.note ? zustand.quellen.filter((q) => q.note === stelle.note).map((q) => q.bereich) : [stelle.bereich];
  setzeHighlight("quelle-aktiv", bereiche);
  stelle.teil?.classList.add("aktiv");
  if (vomApparat) sichtbarMachen(bereiche[0]);
}

function hebeAuf() {
  document.querySelectorAll(".eintrag.aktiv, .teil.aktiv").forEach((e) => e.classList.remove("aktiv"));
  setzeHighlight("lemma-aktiv", []);
  setzeHighlight("quelle-aktiv", []);
}

function enthaelt(aussen, innen) {
  return aussen.compareBoundaryPoints(Range.START_TO_START, innen) <= 0 && aussen.compareBoundaryPoints(Range.END_TO_END, innen) >= 0;
}

/** "Show lemmata": Variants – die größten (nicht in anderen enthaltenen) Lemmata, Sources – die Quellenstellen */
function zeigeLinien() {
  const an = nachId("opt-lemmata").checked;
  document.body.classList.toggle("lemmata-sichtbar", an);
  const liste = zustand.modus === "quellen" ? zustand.quellen : zustand.lemmata;
  const oberste = liste.filter((x) => !liste.some((y) => y !== x && y.laenge > x.laenge && enthaelt(y.bereich, x.bereich)));
  setzeHighlight("linien", an ? oberste.map((x) => x.bereich) : []);
}

/** Modus des Haupttextes setzen */
function setzeModus(modus, merken = true) {
  zustand.modus = modus === "quellen" ? "quellen" : "varianten";
  document.body.classList.toggle("modus-quellen", zustand.modus === "quellen");
  document.body.classList.toggle("modus-varianten", zustand.modus === "varianten");
  nachId("modus-" + zustand.modus).checked = true;
  // Allegationen im Text sind nur im Sources-Modus bedienbar (auch mit der Tastatur)
  for (const ref of document.querySelectorAll("tei-body tei-ref[type=allegation]")) {
    const ziel = ref.querySelector(":scope > a") || ref;
    ziel.tabIndex = zustand.modus === "quellen" ? 0 : -1;
  }
  nachId("popup").hidden = true;
  hebeAuf();
  schwebe(null);
  zeigeLinien();
  if (merken) einstellung.merken("modus", zustand.modus);
}

function caretAusPunkt(x, y) {
  if (document.caretPositionFromPoint) {
    const p = document.caretPositionFromPoint(x, y);
    return p && { knoten: p.offsetNode, offset: p.offset };
  }
  if (document.caretRangeFromPoint) {
    const r = document.caretRangeFromPoint(x, y);
    return r && { knoten: r.startContainer, offset: r.startOffset };
  }
  return null;
}

/** Liegt der Punkt (x, y) auf dem Text eines Bereichs? */
function trifft(bereich, x, y) {
  for (const box of bereich.getClientRects()) {
    if (box.width && x >= box.left - 1 && x <= box.right + 1 && y >= box.top - 1 && y <= box.bottom + 1) return true;
  }
  return false;
}

/** Kleinste Stelle der Liste unter dem Mauszeiger (bei verschachtelten Lemmata die innerste) */
function stelleUnterMaus(ev, liste) {
  const pos = caretAusPunkt(ev.clientX, ev.clientY);
  if (!pos || !pos.knoten || pos.knoten.parentElement?.closest(".zeilennummer, .folio-marke, .spaltenwechsel")) return null;
  let beste = null;
  for (const x of liste) {
    if (beste && x.laenge >= beste.laenge) continue;
    if (x.bereich.isPointInRange(pos.knoten, pos.offset) && trifft(x.bereich, ev.clientX, ev.clientY)) beste = x;
  }
  return beste;
}

function aktuelleListe() {
  return zustand.modus === "quellen" ? zustand.quellen : zustand.lemmata;
}

/** Schwache Markierung der Stelle unter der Maus (ev = null: aufheben) */
function schwebe(ev) {
  const edition = nachId("edition");
  const imText = ev && ev.target.closest && !ev.target.closest(".apparate, .register, .folio-marke, .faksimile, body.viewer-ansicht .q-marke");
  const stelle = imText ? stelleUnterMaus(ev, aktuelleListe()) : null;
  edition.classList.toggle("zeiger", !!stelle);
  if (stelle === zustand.schwebend) return;
  zustand.schwebend = stelle;
  const quelle = stelle && zustand.modus === "quellen";
  setzeHighlight("lemma-hover", stelle && !quelle ? [stelle.bereich] : []);
  setzeHighlight("quelle-hover", quelle ? [stelle.bereich] : []);
  setzeHighlight("block-hover", quelle && stelle.block ? [bereichVon(stelle.block)] : []);
}

function zeigePopup(ev, html, beiKlick) {
  const popup = nachId("popup");
  const e = document.createElement("span");
  e.className = "eintrag";
  e.innerHTML = html;
  if (beiKlick) e.addEventListener("click", (x) => { x.stopPropagation(); beiKlick(); });
  popup.replaceChildren(e);
  popup.hidden = false;
  popup.style.left = "0px";   // Breite ohne Einfluss der vorigen Position messen (sonst auf Handys bis an den Rand)
  popup.style.left = Math.min(ev.pageX + 8, scrollX + innerWidth - popup.offsetWidth - 16) + "px";
  popup.style.top = ev.pageY + 14 + "px";
}

/** Eintrag des Quellenapparats zu einer Stelle, mit seiner Zeilenzahl (für das kleine Fenster) */
function quelleHtml(stelle) {
  if (!stelle.teil) return esc(stelle.el?.getAttribute("cref") || "");
  const z = stelle.teil.closest(".eintrag")?.querySelector(".z")?.textContent || "";
  return `<span class="z">${esc(z)}</span>${stelle.teil.innerHTML}`;
}

function textInteraktion(edition) {
  const popup = nachId("popup");
  if (!hatHighlights) {   // ältere Browser: Lemma nur als Auswahl markiert, Quellen/Überfahren/"Show lemmata" ohne Farbe
    document.body.classList.add("ohne-highlights");
    nachId("browser-hinweis").hidden = false;
  }
  let letzte = null, geplant = false;
  edition.addEventListener("mousemove", (ev) => {
    letzte = ev;
    if (geplant) return;
    geplant = true;
    requestAnimationFrame(() => { geplant = false; schwebe(letzte); });
  });
  edition.addEventListener("mouseleave", () => schwebe(null));
  addEventListener("scroll", () => { if (zustand.schwebend) schwebe(null); }, { passive: true });

  edition.addEventListener("click", (ev) => {
    if (ev.target.closest(".apparate, .register, a")) return;   // Apparat, Register, Links (u.a. Allegationen im Sources-Modus)
    if (ev.target.closest("body.viewer-ansicht .q-marke")) { popup.hidden = true; hebeAuf(); return; }   // zeigt P
    const stelle = stelleUnterMaus(ev, aktuelleListe());
    if (!stelle) { popup.hidden = true; hebeAuf(); return; }
    if (stelle.art === "lemma") {
      aktiviere(stelle.app);
      zeigePopup(ev, eintragHtml(stelle.app), () => aktiviere(stelle.app));
    } else {
      aktiviereQuelle(stelle);
      zeigePopup(ev, quelleHtml(stelle));
    }
  });
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") { popup.hidden = true; hebeAuf(); } });
  // Tippen/Klicken daneben schließt das kleine Fenster; "pointerdown" statt "click", weil iPhone und iPad beim Antippen
  // von Flächen ohne eigene Klickfunktion (Kopf, Ränder) kein "click" an das Dokument melden
  document.addEventListener("pointerdown", (ev) => {
    if (!ev.target.closest("#popup, #edition")) popup.hidden = true;
  });
}

/* ---------------------------------------------------------------- Navigation, Register, Zitieren */

function inhaltsverzeichnis(edition, xml) {
  const liste = document.getElementById("inhalt");
  for (const div of edition.querySelectorAll("tei-div[type=quaestio]")) {
    const xmlDiv = teiKinder(xml, "div").find((d) => d.getAttribute("xml:id") === div.id);
    const p = xmlDiv ? teiKinder(xmlDiv, "p")[0] : null;
    const text = p ? Array.from(p.childNodes).filter((k) => k.localName !== "label").map((k) => k.textContent).join("").replace(/\s+/g, " ").trim() : "";
    const li = document.createElement("li");
    li.innerHTML = `<a href="#${esc(div.id)}"><span class="q">q.${esc(div.getAttribute("n"))}</span><span class="incipit">${esc(text.split(" ").slice(0, 5).join(" "))} …</span></a>`;
    liste.appendChild(li);
  }
  // aktuelle Quaestio beim Lesen markieren (auch für den Zitiervorschlag)
  const verweise = new Map(Array.from(liste.querySelectorAll("a"), (a) => [a.getAttribute("href").slice(1), a]));
  const beobachter = new IntersectionObserver((eintraege) => {
    for (const e of eintraege) {
      if (e.isIntersecting) {
        zustand.quaestioAktuell = e.target;
        verweise.forEach((a) => a.classList.remove("aktuell"));
        verweise.get(e.target.id)?.classList.add("aktuell");
      }
    }
  }, { rootMargin: "-20% 0px -70% 0px" });
  edition.querySelectorAll("tei-div[type=quaestio]").forEach((d) => beobachter.observe(d));
  document.getElementById("knopf-inhalt").addEventListener("click", (ev) => {
    const nav = document.getElementById("navigation");
    const offen = nav.classList.toggle("offen");
    ev.currentTarget.setAttribute("aria-expanded", String(offen));
  });
}

function stelleVon(el) {
  const q = quaestioVon(el);
  const z = zustand.zeilenVon.get(el);
  return { text: `${q ? "q." + q.getAttribute("n") + ", " : ""}l. ${z ? z.start : "?"}`, ziel: z ? "line-" + z.start : "" };
}

function stellenHtml(elemente) {
  return elemente.map((el) => { const s = stelleVon(el); return `<a href="#${s.ziel}">${esc(s.text)}</a>`; }).join("; ");
}

function gratianSchluessel(c) {
  let m;
  if ((m = /^D\.(\d+)(?: c\.(\d+))?/.exec(c))) return [1, +m[1], 0, +(m[2] || 0)];
  if ((m = /^C\.(\d+) q\.(\d+)(?: et \d+)?(?: (?:c|p\.c|a\.c)\.(\d+))?/.exec(c))) return [2, +m[1], +m[2], +(m[3] || 0)];
  if ((m = /^De poen\. D\.(\d+)(?: c\.(\d+))?/.exec(c))) return [3, +m[1], 0, +(m[2] || 0)];
  if ((m = /^De cons\. D\.(\d+)(?: c\.(\d+))?/.exec(c))) return [4, +m[1], 0, +(m[2] || 0)];
  return [9, 0, 0, 0];
}

function vergleiche(a, b) {
  const x = gratianSchluessel(a), y = gratianSchluessel(b);
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return a.localeCompare(b);
}

function register(edition, xml, erweitere) {
  const reg = document.createElement("section");
  reg.className = "register";

  // Personen, mit Verweisformen ("Euthenius → see Euthemius")
  const eintraege = [];
  for (const liste of teiKinder(xml, "listPerson").filter((l) => l.getAttribute("type") !== "divine")) {
    for (const p of teiKinder(liste, "person")) {
      const id = p.getAttribute("xml:id");
      const namen = teiKinder(p, "persName");
      const haupt = namen.find((n) => !n.getAttribute("type"))?.textContent.trim() || id;
      const notiz = teiKinder(p, "note")[0]?.textContent.trim();
      const stellen = Array.from(edition.querySelectorAll(`tei-body tei-persname[ref="#${CSS.escape(id)}"]`));
      eintraege.push({ sortierung: haupt, html: `<li id="reg-${esc(id)}"><strong>${esc(haupt)}</strong> <span class="stellen">${stellenHtml(stellen)}</span>${notiz ? `<span class="anm">${esc(notiz)}</span>` : ""}</li>` });
      for (const v of namen.filter((n) => n.getAttribute("type") === "variant")) {
        eintraege.push({ sortierung: v.textContent.trim(), html: `<li>${esc(v.textContent.trim())} <span class="verweis">→ see</span> <a href="#reg-${esc(id)}">${esc(haupt)}</a></li>` });
      }
    }
  }
  eintraege.sort((a, b) => a.sortierung.localeCompare(b.sortierung));
  const offen = Array.from(edition.querySelectorAll("tei-body tei-persname:not([ref])"));
  reg.innerHTML += `<h2 id="register-personen">Index of persons</h2><ul>${eintraege.map((e) => e.html).join("")}</ul>`
    + (offen.length ? `<h3>Unresolved sigla</h3><ul>${offen.map((n) => `<li>${esc(n.textContent)} <span class="stellen">${stellenHtml([n])}</span></li>`).join("")}</ul>` : "");

  // Allegationen nach Quelle und Stelle
  const nachQuelle = {};
  for (const ref of edition.querySelectorAll("tei-body tei-ref[type=allegation]")) {
    const art = ref.getAttribute("subtype");
    ((nachQuelle[art] ||= {})[ref.getAttribute("cref")] ||= []).push(ref);
  }
  let html = `<h2 id="register-allegationen">Index of allegations</h2>`;
  for (const art of Object.keys(QUELLENART).filter((a) => nachQuelle[a])) {
    const crefs = Object.keys(nachQuelle[art]).sort(art === "gratian" ? vergleiche : (a, b) => a.localeCompare(b));
    html += `<h3>${esc(QUELLENART[art])}</h3><ul>` + crefs.map((c) => {
      const link = nachQuelle[art][c][0].querySelector(":scope > a")?.href;
      return `<li>${link ? `<a href="${esc(link)}" target="_blank" rel="noopener">${esc(c)}</a>` : esc(c)} <span class="stellen">${stellenHtml(nachQuelle[art][c])}</span></li>`;
    }).join("") + "</ul>";
  }
  reg.innerHTML += html;

  // Handschriften
  reg.innerHTML += `<h2 id="register-handschriften">Manuscripts</h2><ul>` + teiKinder(xml, "witness").map((w) =>
    `<li><strong>${esc(w.getAttribute("xml:id"))}</strong> ${esc(w.textContent.trim())}</li>`).join("") + "</ul>"
    + `<p class="hinweis">The critical apparatus records P in full; La, L, Z, B and D are recorded only for allegations and structural formulae (and passages containing them).</p>`;
  edition.appendChild(reg);
}

function zitieren(xml) {
  const dialog = document.getElementById("dialog-zitieren");
  const text = document.getElementById("zitieren-text");
  const editoren = teiKinder(xml, "editor").map((e) => e.textContent.trim()).join(", ");
  document.getElementById("knopf-zitieren").addEventListener("click", () => {
    const q = zustand.quaestioAktuell || document.querySelector("tei-div[type=quaestio]");
    const lbs = q ? q.querySelectorAll("tei-lb") : [];
    const zeilen = lbs.length ? `, ll. ${lbs[0].getAttribute("n")}–${lbs[lbs.length - 1].getAttribute("n")}` : "";
    const titulus = q?.closest("tei-div[type=titulus]");
    const stelle = titulus ? `D.${titulus.closest("tei-div[type=distinctio]")?.getAttribute("n")} t.${titulus.getAttribute("n")} q.${q.getAttribute("n")}` : "";
    const adresse = location.href.split("#")[0] + (q ? "#" + q.id : "");
    const heute = new Date().toISOString().slice(0, 10);
    text.textContent = `Magistri Honorii Summa Quaestionum ‘De quaestionibus decretalibus tractaturi’, ${stelle}${zeilen}, `
      + `ed. ${editoren}, digital sample edition, working draft of ${zustand.stand || "?"}, ${adresse} (accessed ${heute}).`;
    dialog.showModal();
  });
  document.getElementById("knopf-schliessen").addEventListener("click", () => dialog.close());
  document.getElementById("knopf-kopieren").addEventListener("click", async (ev) => {
    try { await navigator.clipboard.writeText(text.textContent); ev.target.textContent = "Copied"; }
    catch { ev.target.textContent = "Select and copy manually"; }
    setTimeout(() => { ev.target.textContent = "Copy"; }, 2000);
  });
}

function ansichtsoptionen() {
  const optionen = { "opt-zeilen": ["ohne-zeilen", true], "opt-apparat": ["ohne-apparat", true], "opt-lemmata": ["lemmata-sichtbar", false] };
  for (const [id, [klasse, invertiert]] of Object.entries(optionen)) {
    const kasten = document.getElementById(id);
    // ohne gemerkten Wert die Grundeinstellung aus index.html (nicht einen vom Browser wiederhergestellten Zustand)
    const gemerkt = einstellung.lesen(id);
    kasten.checked = gemerkt === null ? kasten.defaultChecked : gemerkt === "1";
    const anwenden = () => {
      if (id === "opt-lemmata") zeigeLinien();
      else document.body.classList.toggle(klasse, invertiert ? !kasten.checked : kasten.checked);
      einstellung.merken(id, kasten.checked ? "1" : "0");
    };
    kasten.addEventListener("change", anwenden);
    anwenden();
  }
  // Modus des Haupttextes: Variants (Standard) | Sources
  const modus = einstellung.lesen("modus") === "quellen" ? "quellen" : "varianten";
  for (const knopf of document.querySelectorAll("input[name=modus]")) {
    knopf.addEventListener("change", () => { if (knopf.checked) setzeModus(knopf.value); });
  }
  setzeModus(modus, false);
}

/* ---------------------------------------------------------------- Parallelansicht (Handschrift P) */

const viewer = {
  osd: null,          // OpenSeadragon, beim ersten Einschalten erzeugt
  laden: null,        // Promise: Bibliothek wird geladen
  seiten: [],         // Seiten von P aus <facsimile>: {id, n, info, gallica}
  seite: -1,          // im Viewer gezeigte Seite (Index)
  leseSeite: null,    // Seite, auf der die Leseposition liegt (xml:id der <surface>)
  anfang: null,       // Seite, auf der der Titulus beginnt
  zonen: new Map(),   // Label "q.N" -> Eingangsfrage in P: {flaeche, folio, rechteck, punkte, label}
  zielZone: null,     // Zone, die nach dem Öffnen ihrer Seite eingerahmt wird
};

function nachId(id) { return document.getElementById(id); }

/** Höhe des (beim Scrollen stehenbleibenden) Kopfes als CSS-Variable --kopf */
function kopfHoehe() {
  const kopf = document.querySelector(".kopf");
  const h = getComputedStyle(kopf).position === "sticky" ? kopf.offsetHeight : 0;
  document.documentElement.style.setProperty("--kopf", h + "px");
  return h;
}

function viewerAnsicht(edition, xml, erweitere) {
  viewer.seiten = teiKinder(xml, "surface").map((s) => {
    const bild = teiKinder(s, "graphic").find((g) => g.getAttribute("type") !== "viewer")?.getAttribute("url") || "";
    const iiif = /^(.*)\/full\/[^/]+\/0\/[^/]+$/.exec(bild);    // IIIF-Bildadresse -> Beschreibung info.json
    return { id: s.getAttribute("xml:id"), n: s.getAttribute("n"), info: iiif ? iiif[1] + "/info.json" : null, gallica: ansichtVon(s, erweitere) };
  }).filter((s) => s.info);
  if (!viewer.seiten.length) { document.querySelector(".ansicht-schalter").hidden = true; return; }
  viewer.anfang = (edition.querySelector("tei-div[type=titulus][facs]")?.getAttribute("facs") || "").replace(/^#/, "") || viewer.seiten[0].id;

  nachId("knopf-lesen").addEventListener("click", () => setzeAnsicht(false));
  nachId("knopf-viewer").addEventListener("click", () => setzeAnsicht(true));
  nachId("viewer-zurueck").addEventListener("click", () => blaettere(-1));
  nachId("viewer-vor").addEventListener("click", () => blaettere(1));
  nachId("viewer-groesser").addEventListener("click", () => { viewer.osd?.viewport.zoomBy(1.4); viewer.osd?.viewport.applyConstraints(); });
  nachId("viewer-kleiner").addEventListener("click", () => { viewer.osd?.viewport.zoomBy(1 / 1.4); viewer.osd?.viewport.applyConstraints(); });
  nachId("viewer-ganz").addEventListener("click", () => viewer.osd?.viewport.goHome());
  nachId("viewer-folgen").addEventListener("change", (ev) => { if (ev.target.checked) folge(true); });

  // Inhalt/Ansichtsoptionen liegen in der Parallelansicht als Feld über dem Text: nach der Wahl eines
  // Eintrags, bei Klick daneben und mit Esc schließen
  const nav = nachId("navigation");
  const schliesseNav = () => { nav.classList.remove("offen"); nachId("knopf-inhalt").setAttribute("aria-expanded", "false"); };
  nav.addEventListener("click", (ev) => { if (ev.target.closest("a") && document.body.classList.contains("viewer-ansicht")) schliesseNav(); });
  document.addEventListener("pointerdown", (ev) => {   // "pointerdown": s. textInteraktion (iPhone/iPad)
    if (document.body.classList.contains("viewer-ansicht") && nav.classList.contains("offen") && !ev.target.closest("#navigation, #knopf-inhalt")) schliesseNav();
  });
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && document.body.classList.contains("viewer-ansicht")) schliesseNav(); });

  zonenP(edition, xml);

  // Randmarke "fol. 61ra": in der Parallelansicht zur Seite blättern statt Gallica zu öffnen
  edition.addEventListener("click", (ev) => {
    const marke = ev.target.closest(".folio-marke");
    if (!marke || !document.body.classList.contains("viewer-ansicht") || !marke.dataset.flaeche) return;
    ev.preventDefault();
    zeigeSeite(marke.dataset.flaeche);
  });

  // beim Lesen mitblättern (höchstens einmal je Bildaufbau)
  let geplant = false;
  addEventListener("scroll", () => {
    if (geplant) return;
    geplant = true;
    requestAnimationFrame(() => { geplant = false; folge(false); });
  }, { passive: true });
  addEventListener("resize", kopfHoehe);
  kopfHoehe();

  if (einstellung.lesen("ansicht") === "viewer") setzeAnsicht(true, false);
}

/** Zwischen Leseansicht und Parallelansicht wechseln; die Leseposition bleibt erhalten */
function setzeAnsicht(an, merken = true) {
  // oberste sichtbare Zeile merken und nach dem Umschalten an dieselbe Stelle des Bildschirms rücken
  const kopf = kopfHoehe();
  const zeile = Array.from(document.querySelectorAll("tei-body tei-lb")).find((lb) => lb.getBoundingClientRect().top >= kopf);
  const versatz = zeile ? zeile.getBoundingClientRect().top : 0;
  document.body.classList.toggle("viewer-ansicht", an);
  randspalte();
  nachId("knopf-lesen").setAttribute("aria-pressed", String(!an));
  nachId("knopf-viewer").setAttribute("aria-pressed", String(an));
  nachId("navigation").classList.remove("offen");
  qMarken(an);
  if (merken) {
    einstellung.merken("ansicht", an ? "viewer" : "lesen");
    if (zeile && scrollY > 0) requestAnimationFrame(() => window.scrollBy(0, zeile.getBoundingClientRect().top - versatz));
  }
  if (an) starteViewer().then(() => folge(true));
}

function ladeSkript(src) {
  return new Promise((ok, fehler) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = ok;
    s.onerror = fehler;
    document.head.appendChild(s);
  });
}

function viewerMeldung(text) {
  const p = nachId("viewer-meldung");
  p.hidden = !text;
  p.innerHTML = text || "";
}

async function starteViewer() {
  if (viewer.osd) return;
  viewer.laden ||= ladeSkript("lib/openseadragon.min.js");
  try {
    await viewer.laden;
  } catch {
    viewerMeldung("The image viewer could not be loaded.");
    return;
  }
  if (viewer.osd) return;
  const start = Math.max(0, viewer.seiten.findIndex((s) => s.id === (leseSeite() || viewer.anfang)));
  viewer.osd = OpenSeadragon({
    element: nachId("viewer-bild"),
    tileSources: viewer.seiten.map((s) => s.info),
    sequenceMode: true,
    initialPage: start,
    showNavigationControl: false,          // eigene Bedienleiste
    showSequenceControl: false,
    crossOriginPolicy: "Anonymous",        // Gallica erlaubt das Einbinden (Access-Control-Allow-Origin: *)
    drawer: "canvas",                      // klassischer Zeichner: läuft überall (WebGL braucht in OSD 6 OffscreenCanvas)
    visibilityRatio: 0.5,
    minZoomImageRatio: 0.8,
    maxZoomPixelRatio: 2.5,
    gestureSettingsMouse: { clickToZoom: false },
    animationTime: 0.8,
  });
  viewer.osd.addHandler("page", (ev) => seiteGezeigt(ev.page));
  viewer.osd.addHandler("open", () => {
    viewerMeldung(null);
    // beim Öffnen einer Seite verschwinden Overlays von selbst; ein angeforderter Rahmen kommt jetzt dazu
    if (viewer.zielZone) zoneEinblenden();
    else markiereQMarke(null);
  });
  viewer.osd.addHandler("open-failed", () => {
    const s = viewer.seiten[viewer.seite];
    viewerMeldung(`The image could not be loaded from Gallica.${s ? ` <a href="${esc(s.gallica)}" target="_blank" rel="noopener noreferrer">Open fol. ${esc(s.n)} in Gallica ↗</a>` : ""}`);
  });
  seiteGezeigt(start);
}

/** Bedienleiste an die gezeigte Seite anpassen */
function seiteGezeigt(i) {
  viewer.seite = i;
  const s = viewer.seiten[i];
  nachId("viewer-seite").textContent = s ? `MS P, fol. ${s.n}` : "MS P";
  if (s) nachId("viewer-gallica").href = s.gallica;
  nachId("viewer-zurueck").disabled = i <= 0;
  nachId("viewer-vor").disabled = i >= viewer.seiten.length - 1;
}

/** Seite von P im Viewer zeigen (xml:id der <surface>) */
function zeigeSeite(id) {
  const i = viewer.seiten.findIndex((s) => s.id === id);
  if (i < 0 || !viewer.osd) return;
  if (i !== viewer.seite) viewer.osd.goToPage(i);
  else viewer.osd.viewport.goHome();
}

/** Im Viewer blättern (‹ ›); bei "Follow text" springt der Text an den Anfang der neuen Seite */
function blaettere(schritt) {
  const i = viewer.seite + schritt;
  if (!viewer.osd || i < 0 || i >= viewer.seiten.length) return;
  viewer.osd.goToPage(i);
  if (nachId("viewer-folgen").checked) textZuSeite(viewer.seiten[i].id);
}

/** Text an den Anfang einer Seite von P rücken: Strich des ersten Spaltenwechsels auf dieser Seite, bei der
 *  Anfangsseite die Überschrift des Titulus. Sofort (nicht sanft), damit das Mitblättern unterwegs nicht anspringt. */
function textZuSeite(id) {
  const strich = Array.from(document.querySelectorAll(".spaltenwechsel[data-flaeche]")).find((s) => s.dataset.flaeche === id);
  const ziel = strich || (id === viewer.anfang ? document.querySelector("tei-div[type=titulus]") : null);
  if (!ziel) return;
  viewer.leseSeite = id;   // Leseposition liegt danach auf dieser Seite: Mitblättern bleibt still
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
  // nachmessen: in schmalen Fenstern bleibt der Viewer erst nach dem Scrollen oben stehen und verdeckt mehr
  for (let versuch = 0; versuch < 3; versuch++) {
    const fehlt = ziel.getBoundingClientRect().top - textOben() - 0.75 * rem;
    if (Math.abs(fehlt) < 1) break;
    window.scrollBy(0, fehlt);
  }
  // Randmarke (bzw. Link in der Titelzeile) kurz aufleuchten lassen
  const marke = strich ? strich.nextElementSibling : ziel.querySelector(".faksimile");
  if (marke) {
    marke.classList.remove("aufleuchten");
    void marke.offsetWidth;   // Animation neu starten
    marke.classList.add("aufleuchten");
  }
}

/** Oberkante des sichtbaren Textes: unter dem Kopf, in schmalen Fenstern der Parallelansicht unter dem Viewer */
function textOben() {
  const kopf = kopfHoehe();
  if (!document.body.classList.contains("viewer-ansicht")) return kopf;
  const v = nachId("viewer").getBoundingClientRect();
  const m = nachId("edition").getBoundingClientRect();
  return v.left < m.right - 1 && v.bottom > kopf ? v.bottom : kopf;   // Viewer steht über dem Text
}

/** Seite von P an der Leseposition (etwa ein Viertel unter der Oberkante des sichtbaren Textes) */
function leseSeite() {
  const oben = textOben();
  const linie = oben + (innerHeight - oben) * 0.25;
  let id = viewer.anfang;
  for (const strich of document.querySelectorAll(".spaltenwechsel[data-flaeche]")) {
    if (strich.getBoundingClientRect().top > linie) break;
    id = strich.dataset.flaeche;
  }
  return id;
}

/** Mitblättern: nur wenn die Leseposition eine neue Seite erreicht (freies Blättern im Viewer bleibt sonst stehen) */
function folge(sofort) {
  if (!viewer.osd || !document.body.classList.contains("viewer-ansicht") || !nachId("viewer-folgen").checked) return;
  const id = leseSeite();
  if (!sofort && id === viewer.leseSeite) return;
  viewer.leseSeite = id;
  const i = viewer.seiten.findIndex((s) => s.id === id);
  if (i >= 0 && i !== viewer.seite) viewer.osd.goToPage(i);
}

/* Eingangsfragen in P: In der Parallelansicht ist "q.N" anklickbar (Maus und Tastatur); der Klick blättert zur Seite
 * von P, zoomt auf die Eingangsfrage und rahmt sie ein (TEI: <zone points> in der <surface>, @facs am ersten
 * div type="queritur"; Entscheidungen des Herausgebers vom 25.10.2026). In der Leseansicht bleibt "q.N" unverändert. */

function zonenP(edition, xml) {
  const zonen = new Map(teiKinder(xml, "zone").map((z) => [z.getAttribute("xml:id"), z]));
  for (const div of edition.querySelectorAll("tei-div[facs]")) {
    const z = zonen.get(div.getAttribute("facs").replace(/^#/, ""));
    const label = div.querySelector("tei-label");
    if (!z || !label) continue;
    const zahl = (name) => Number(z.getAttribute(name));
    const rechteck = [zahl("ulx"), zahl("uly"), zahl("lrx"), zahl("lry")];
    if (rechteck.some((v) => Number.isNaN(v))) continue;
    const flaeche = z.parentNode;
    viewer.zonen.set(label, {
      flaeche: flaeche.getAttribute("xml:id"), folio: flaeche.getAttribute("n") || "", rechteck,
      punkte: z.getAttribute("points") || `${rechteck[0]},${rechteck[1]} ${rechteck[2]},${rechteck[1]} ${rechteck[2]},${rechteck[3]} ${rechteck[0]},${rechteck[3]}`,
      label,
    });
    label.classList.add("q-marke");
    const los = (ev) => {
      if (!document.body.classList.contains("viewer-ansicht")) return;
      ev.preventDefault();
      zeigeZone(viewer.zonen.get(label));
    };
    label.addEventListener("click", los);
    label.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") los(ev); });
  }
}

/** "q.N" nur in der Parallelansicht als Knopf: Tastatur, Tooltip, Bildschirmleser */
function qMarken(an) {
  for (const [label, zone] of viewer.zonen) {
    if (an) {
      const text = `Show the opening question of ${label.textContent.trim()} in MS P, fol. ${zone.folio}`;
      label.tabIndex = 0;
      label.setAttribute("role", "button");
      label.title = text;
      label.setAttribute("aria-label", text);
    } else {
      for (const name of ["tabindex", "role", "title", "aria-label"]) label.removeAttribute(name);
    }
  }
  if (!an) markiereQMarke(null);
}

function markiereQMarke(label) {
  for (const l of viewer.zonen.keys()) l.classList.toggle("gezeigt", l === label);
}

/** Zur Seite der Zone blättern; eingerahmt wird nach dem Öffnen der Seite (bzw. sofort, wenn sie schon offen ist) */
async function zeigeZone(zone) {
  if (!zone) return;
  await starteViewer();
  if (!viewer.osd) return;
  const i = viewer.seiten.findIndex((s) => s.id === zone.flaeche);
  if (i < 0) return;
  viewer.zielZone = zone;
  if (i !== viewer.seite) viewer.osd.goToPage(i);
  else if (viewer.osd.world.getItemAt(0)) zoneEinblenden();
}

/** Rahmen als Overlay über die Eingangsfrage legen und den Ausschnitt mit etwas Umgebung zeigen */
function zoneEinblenden() {
  const zone = viewer.zielZone;
  const bild = viewer.osd?.world.getItemAt(0);
  if (!zone || !bild || viewer.seiten[viewer.seite]?.id !== zone.flaeche) return;
  viewer.zielZone = null;
  viewer.osd.clearOverlays();
  const [x0, y0, x1, y1] = zone.rechteck;
  const ns = "http://www.w3.org/2000/svg";
  const rahmen = document.createElement("div");
  rahmen.className = "zone-rahmen";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `${x0} ${y0} ${x1 - x0} ${y1 - y0}`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("aria-hidden", "true");
  const form = document.createElementNS(ns, "polygon");
  form.setAttribute("points", zone.punkte);
  form.setAttribute("vector-effect", "non-scaling-stroke");   // Linie bleibt beim Zoomen gleich stark
  svg.appendChild(form);
  rahmen.appendChild(svg);
  viewer.osd.addOverlay({ element: rahmen, location: bild.imageToViewportRectangle(x0, y0, x1 - x0, y1 - y0) });
  // etwa zwei Zeilen darüber und darunter, links und rechts etwas Rand
  const rand = 60;
  viewer.osd.viewport.fitBoundsWithConstraints(bild.imageToViewportRectangle(x0 - rand, y0 - 2 * rand, x1 - x0 + 2 * rand, y1 - y0 + 4 * rand));
  markiereQMarke(zone.label);
}

function springeZuAnker() {
  if (!location.hash) return;
  const ziel = document.getElementById(decodeURIComponent(location.hash.slice(1)));
  if (ziel) setTimeout(() => ziel.scrollIntoView({ block: "start" }), 50);
}
