(() => {
  "use strict";

  const subjectLabels = "SUBJECT(?: MATTER|\\s*/\\s*PARTICULARS)?|SUBJ\\.?|SUBJEC[I1L]|SUB3ECT|SUBIECT|PAKSA|REGARDING|RE";
  const recipientLabels = "ADDRESSED TO|MEM[O0]RANDUM F[O0]R|RECIPIENT(?: OFFICE)?|SENT TO|T[O0]|F[O0]R|PARA(?: KAY| SA)?";
  const issuerLabels = "ISSUED BY|ISSUING OFFICE";
  const originLabels = "FR[O0]M|MULA(?: KAY| SA)?|ORIGINATING OFFICE";
  const senderLabels = "RECEIVED FROM|SENDER";
  const controlLabels = "(?:DOCUMENT )?(?:CONTROL|TRACKING)(?:\\s*(?:NO\\.?|NUMBER|#))?";
  const referenceLabels = "REFERENCE(?: NO\\.?| NUMBER)?|REF\\.?(?: NO\\.?| NUMBER)?";
  const memoNumberLabels = "MEMO(?:RANDUM)?\\s+(?:NO\\.?|NUMBER|#)";
  const actionLabels = "ACTION(?: TAKEN)?\\s*/\\s*DATE FORWARDED|ACTION TAKEN";
  const remarksLabels = "REMARKS?|NOTES?";
  const dateLabels = {
    date: "D[A@]TE|D[A@]TE ISSUED|ISSUE D[A@]TE|DATED|PETSA",
    receivedDate: "D[A@]TE RECEIVED|RECEIVED D[A@]TE",
    releasedDate: "D[A@]TE (?:RELEASED|SENT)|(?:RELEASED|SENT) D[A@]TE"
  };
  const labels = [
    subjectLabels, "PARTICULARS", recipientLabels, issuerLabels, originLabels, senderLabels, controlLabels,
    referenceLabels, memoNumberLabels, ...Object.values(dateLabels), actionLabels, remarksLabels,
    "D[A@]TE FORWARDED|(?:RECORD )?STATUS|DOCUMENT TYPE|COMMUNICATION TYPE|DIRECTION|SIGNATORY|THROUGH|THRU|CC|ATTACHMENTS?|ENCLOSURES?"
  ].join("|");
  const inlineLabel = new RegExp("^(" + labels + ")\\s*(?::|：|;|[–—-])\\s*(.*)$", "i");
  const bareLabel = new RegExp("^(" + labels + ")$", "i");
  const columns = new RegExp("(?:[ \\t]{2,}|\\t+|\\s*\\|\\s*)(?=(?:" + labels + ")\\s*[:：;])", "i");
  const tableCell = new RegExp("^(" + labels + ")(?:[ \\t]{2,}|\\t+|\\s*\\|\\s*)(?=[^\\s:：;–—-])", "i");
  const isSubject = new RegExp("^(?:" + subjectLabels + "|PARTICULARS)$", "i");
  const placeholder = /^[:：;|]*$|^[-_.=–—]{2,}$/;
  const unknownField = /^(?:N\/?A|NONE|NIL|NOT APPLICABLE|NOT AVAILABLE|[-_.=–—]{2,})$/i;
  const continuation = /^(?:FOR|OF|ON|AND|OR|WITH|REGARDING|DURING)\b/i;
  const dateLine = /^(?:\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{4}|[A-Za-z]+\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}|\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+\.?,?\s+\d{4})$/i;
  const months = "january february march april may june july august september october november december".split(" ");
  const monthAliases = {sept:9,enero:1,ene:1,pebrero:2,peb:2,marso:3,abril:4,abr:4,mayo:5,hunyo:6,hulyo:7,hul:7,agosto:8,ago:8,setyembre:9,septiyembre:9,set:9,oktubre:10,okt:10,nobyembre:11,nob:11,disyembre:12,dis:12};
  for (const [index, month] of months.entries()) {
    monthAliases[month] = index + 1;
    monthAliases[month.slice(0, 3)] = index + 1;
  }
  const referenceNumber = /^(?=[A-Z0-9/._-]*\d)[A-Z0-9][A-Z0-9/._-]*(?:,?\s*s\.?\s*\d{4})?$/i;
  const prefix = "(?:(?:PG\\s*ENRO|PROVINCIAL ENRO)\\s+)?";
  const memoHeading = new RegExp("^" + prefix + "(?:OFFICE\\s+)?(?:MEM[O0]RANDUM(?:\\s+(?:ORDER|CIRCULAR|JOINT))?|MEMO)(?:\\s+(?:N[O0]\\.?|NUMBER|FOR|SERIES)\\b.*|\\s*[:#.-]?\\s*\\d.*|\\s*:)?$", "i");
  const orderHeading = new RegExp("^" + prefix + "((?:OFFICE|SPECIAL|TRAVEL)\\s+ORDER)(?:\\s+(?:N[O0]\\.?|NUMBER|SERIES)\\b.*|\\s*[:#.-]?\\s*\\d.*)?$", "i");
  const bodyStart = /^(?:DEAR|GREETINGS|GOOD (?:DAY|MORNING|AFTERNOON)|SIR|MADAM|MA'AM|TO WHOM|PLEASE|KINDLY|THIS (?:IS|HAS|WILL|REFERS|SERVES|LETTER|MEMO|MEMORANDUM)|WE (?:ARE|WILL|WOULD|REQUEST|HEREBY)|I (?:AM|WOULD|WRITE|HEREBY|RESPECTFULLY)|YOU ARE|THE UNDERSIGNED|IN (?:LIGHT OF|CONNECTION WITH|ACCORDANCE WITH|VIEW OF)|PURSUANT|FOR YOUR (?:INFORMATION|COMPLIANCE|GUIDANCE)|SINCERELY|RESPECTFULLY|YOURS TRULY|BEST REGARDS|MAGANDANG (?:ARAW|UMAGA|HAPON)|MAHAL NA|MANGYARING|PAKIUSAP|KAMI (?:AY|PO)|AKO (?:AY|PO)|KAUGNAY|LUBOS NA GUMAGALANG|IPINAPABATID|NAIS (?:KO|NAMING)|SIGNED BY|SUBMITTED BY|PREPARED BY|APPROVED BY|ANNEX|APPENDIX|COPY FURNISHED)\b/i;
  const types = ["Memorandum", "Office Order", "Special Order", "Travel Order", "Request Letter", "Endorsement Letter", "Transmittal Letter", "Response Letter", "Notice of Meeting", "Invitation", "Report", "Letter", "Other Communication"];
  const headingTypes = types.slice(4, -2);
  const statusAliases = new Map([
    ["pending", "Pending"], ["for action", "Pending"], ["for review", "Pending"], ["awaiting action", "Pending"],
    ["received", "Received"], ["received and logged", "Received"], ["logged", "Received"], ["accepted", "Received"],
    ["forwarded", "Forwarded"], ["routed", "Forwarded"], ["endorsed", "Forwarded"],
    ["released", "Released"], ["sent out", "Released"], ["dispatched", "Released"],
    ["archived", "Archived"], ["filed", "Archived"]
  ]);

  const labelOf = line => line.match(inlineLabel) || line.match(bareLabel);
  const tidy = line => line.replace(/[ \t]+/g, " ").trim();

  function parseDate(value) {
    const text = String(value || "").trim();
    let year, month, day, match;
    if ((match = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/))) {
      [, year, month, day] = match;
    } else if ((match = text.match(/^([A-Za-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/i))) {
      [, , day, year] = match;
      month = monthAliases[match[1].toLowerCase()];
    } else if ((match = text.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\.?,?\s+(\d{4})$/i))) {
      [, day, , year] = match;
      month = monthAliases[match[2].toLowerCase()];
    } else if ((match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/))) {
      const first = Number(match[1]), second = Number(match[2]);
      year = match[3];
      if (first > 12 && second <= 12) [day, month] = [first, second];
      else if ((second > 12 && first <= 12) || first === second) [month, day] = [first, second];
    }
    if (!year || !month || !day) return "";
    const date = new Date(0);
    date.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
    if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() + 1 !== Number(month) || date.getUTCDate() !== Number(day) || Number(year) < 1) return "";
    return year + "-" + String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0");
  }

  function headerLines(text) {
    const rows = String(text || "").replace(/\r\n?/g, "\n").split("\f")[0].replace(/\u00a0/g, " ").split("\n").slice(0, 140);
    const lines = rows.flatMap((row, index) => row.split(columns).map(cell => ({
      text: tidy(cell.trim().replace(tableCell, "$1: ")),
      number: index + 1
    })));
    let subjectStarted = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].text;
      const label = labelOf(line);
      if (label) {
        if (isSubject.test(label[1]) && label[2] && !placeholder.test(label[2])) subjectStarted = true;
        continue;
      }
      if (bodyStart.test(line)) return lines.slice(0, i);
      if (subjectStarted && line && !lines[i - 1]?.text &&
          !continuation.test(line) && !dateLine.test(line) && !placeholder.test(line)) {
        const previous = lines.slice(0, i).reverse().find(item => item.text);
        const previousLabel = labelOf(previous?.text || "");
        if (!previousLabel || previousLabel[2]) return lines.slice(0, i);
      }
      if (line && isSubject.test(labelOf(lines[i - 1]?.text || "")?.[1] || "")) subjectStarted = true;
    }
    return lines;
  }

  function readField(lines, names, limit = 4, subject = false, stopAtSentence = true) {
    const wanted = new RegExp("^(?:" + names + ")$", "i");
    let empty;
    for (const [i, line] of lines.entries()) {
      const label = labelOf(line.text);
      if (!label || !wanted.test(label[1])) continue;
      empty ??= line;
      if (label[2] && placeholder.test(label[2])) continue;
      const parts = label[2] ? [label[2]] : [];
      for (let offset = 1; i + offset < lines.length && offset <= limit + 2 && parts.length < limit; offset++) {
        const next = lines[i + offset].text;
        if (!next) {
          if (!parts.length && offset <= 2) continue;
          const following = lines.slice(i + offset + 1, i + offset + 3).find(item => item.text)?.text || "";
          if (subject && continuation.test(following) && !labelOf(following)) continue;
          break;
        }
        if (!parts.length && /^[:：;|]+$/.test(next)) continue;
        if (labelOf(next) || memoHeading.test(next) || orderHeading.test(next) ||
            placeholder.test(next) || (limit > 1 && dateLine.test(next))) break;
        if (stopAtSentence && next.split(/\s+/).length >= 5 && /[.!?]$/.test(next) && !continuation.test(next)) break;
        parts.push(next);
      }
      if (parts.length) return {value: tidy(parts.join(" ")), line: line.number, evidence: line.text};
    }
    return {value: "", line: empty?.number ?? null, evidence: empty?.text || ""};
  }

  function letterheadOffice(lines) {
    const generic = /^(?:OFFICE|DEPARTMENT|BUREAU|DIVISION|COMMISSION|AUTHORITY|UNIVERSITY)$/i;
    const department = /\b(?:OFFICE|DEPARTMENT|BUREAU|DIVISION|COMMISSION|AUTHORITY|UNIVERSITY|MUNICIPALITY)\b/i;
    const offices = [];
    for (const [index, line] of lines.entries()) {
      if (!department.test(line) || /\b(?:ORDER|MEMORANDUM)\b|@|https?:/i.test(line)) continue;
      const previous = lines[index - 1] || "";
      if (generic.test(line)) {
        if (previous && previous === previous.toUpperCase() && !/\d|@|^REPUBLIC\b/i.test(previous)) {
          offices.push(previous + " " + line);
        }
      } else {
        offices.push(line);
      }
    }
    return offices.at(-1) || "";
  }

  function parseHeader(text, printedSignatory) {
    const lines = headerLines(text);
    const result = {
      memoNo: "", controlNo: "", date: "", receivedDate: "", releasedDate: "",
      addressedTo: "", recipient: "", receivedFromLabel: "", issuedBy: "", subject: "",
      sender: "", sourceOffice: "", signatory: "", docType: "", documentType: "", isMemo: false,
      direction: "", status: "", actionTaken: "", remarks: "", warnings: [], evidence: {}, fieldEvidence: {}, needsReview: []
    };
    const store = (key, field) => {
      result[key] = ["addressedTo", "recipient", "receivedFromLabel", "issuedBy", "sender"].includes(key) &&
        unknownField.test(field.value) ? "" : field.value;
      result.evidence[key] = field.line;
      result.fieldEvidence[key] = field.evidence;
    };
    const field = (names, limit, subject, stopAtSentence) => readField(lines, names, limit, subject, stopAtSentence);
    const firstSubject = lines.findIndex(({text: line}) => isSubject.test(labelOf(line)?.[1] || ""));
    const headings = lines.slice(0, firstSubject < 0 ? 60 : Math.min(60, firstSubject));
    const headingIndex = headings.findIndex(({text: line}) => memoHeading.test(line) || orderHeading.test(line) ||
      headingTypes.some(type => type.toUpperCase() === line.toUpperCase()));
    if (headingIndex >= 0) {
      const heading = lines[headingIndex];
      const order = heading.text.match(orderHeading);
      result.isMemo = memoHeading.test(heading.text);
      result.docType = result.isMemo ? "Memorandum" :
        types.find(type => type.toUpperCase() === (order?.[1] || heading.text).toUpperCase()) || "";
      result.fieldEvidence.documentType = heading.text;
      const numberText = [
        heading.text,
        ...lines.slice(headingIndex + 1, headingIndex + 5).map(line => line.text)
          .filter(line => /^(?:N[O0]\.?|NUMBER|SERIES(?: OF)?|S\.)\s*[:#.-]?\s*[A-Z0-9]*\d/i.test(line))
      ].join(" ");
      const number = numberText.match(/\b(?:N[O0]\.?|NUMBER)\s*[:#.-]?\s*([A-Z0-9][A-Z0-9/._-]*)/i) ||
        heading.text.match(/(?:MEM[O0]RANDUM|MEMO|ORDER|CIRCULAR)\s*[:#.-]?\s*(\d[\d/._-]*)/i);
      if (number && referenceNumber.test(number[1])) {
        const series = numberText.match(/(?:(?:[,;]|\s)\s*s\.?\s*|\bseries(?:\s+of)?\s+)(\d{4})\b/i);
        const found = {value: number[1] + (series ? ", s. " + series[1] : ""), line: heading.number, evidence: numberText};
        store("controlNo", found);
        if (result.isMemo) store("memoNo", found);
      }
    }

    const printedType = field("DOCUMENT TYPE", 1);
    const direction = field("COMMUNICATION TYPE|DIRECTION", 1);
    const directionValue = ["Incoming", "Outgoing"].find(type => type.toLowerCase() === direction.value.toLowerCase()) || "";
    store("direction", {...direction, value: directionValue});
    if (!result.docType) {
      result.docType = types.find(type => type.toLowerCase() === printedType.value.toLowerCase()) || "";
      result.isMemo = result.docType === "Memorandum";
      if (result.docType) result.fieldEvidence.documentType = printedType.evidence;
    }
    if (result.isMemo && !result.memoNo) {
      const memoNumber = field(memoNumberLabels, 1);
      if (referenceNumber.test(memoNumber.value)) store("memoNo", memoNumber);
    }
    const control = field(controlLabels, 1);
    const reference = control.value || result.controlNo ? control : field(referenceLabels, 1);
    if (referenceNumber.test(reference.value)) store("controlNo", reference);

    const recipient = field(recipientLabels);
    if (!recipient.evidence && result.isMemo && headingIndex >= 0) {
      const heading = lines[headingIndex];
      const match = heading.text.match(/^(?:OFFICE\s+)?MEM[O0]RANDUM\s+F[O0]R\s+(.*)$/i);
      if (match) Object.assign(recipient, {value: match[1], line: heading.number, evidence: heading.text});
    }
    store("addressedTo", recipient);
    store("recipient", recipient);
    const subject = field(subjectLabels, 6, true);
    store("subject", subject.evidence ? subject : field("PARTICULARS", 6, true));
    store("receivedFromLabel", field(senderLabels));
    const issuingOffice = field(issuerLabels);
    store("issuedBy", issuingOffice.evidence ? issuingOffice : field(originLabels));
    result.issuedBySource = result.issuedBy ? "printed" : "";
    store("sender", field(senderLabels + "|" + originLabels));
    result.senderOfficeSource = result.sender ? "printed" : "";
    if (!result.sender && !result.fieldEvidence.sender) {
      const boundary = lines.findIndex(({text: line}) => labelOf(line) || dateLine.test(line));
      const end = Math.min(boundary < 0 ? lines.length : boundary, headingIndex < 0 ? lines.length : headingIndex, 20);
      const office = letterheadOffice(lines.slice(0, end).map(line => line.text).filter(Boolean));
      if (office) {
        store("sender", {value: office, line: null, evidence: office});
        result.senderOfficeSource = "letterhead";
      }
    }
    result.sourceOffice = result.sender;

    for (const [key, names] of Object.entries(dateLabels)) {
      const found = field(names, 1);
      store(key, {...found, value: parseDate(found.value)});
      if (found.value && !result[key]) result.warnings.push("A printed date could not be interpreted unambiguously.");
    }
    if (!result.evidence.date) {
      let previous = "";
      for (const row of headings.filter(line => line.text)) {
        const label = labelOf(previous);
        if (dateLine.test(row.text) && !label) {
          store("date", {value: parseDate(row.text), line: row.number, evidence: row.text});
          if (!result.date) result.warnings.push("A printed date could not be interpreted unambiguously.");
          break;
        }
        previous = row.text;
      }
    }
    const status = field("(?:RECORD )?STATUS", 1);
    store("status", {...status, value: statusAliases.get(status.value.toLowerCase().replace(/[^a-z]+/g, " ").trim()) || ""});
    const action = field(actionLabels, 3, false, false);
    const forwarded = field("D[A@]TE FORWARDED", 1);
    if (parseDate(forwarded.value)) {
      action.value = [action.value, "Date forwarded: " + forwarded.value].filter(Boolean).join("\n");
      action.evidence = [action.evidence, forwarded.evidence].filter(Boolean).join("\n");
    }
    store("actionTaken", action);
    store("remarks", field(remarksLabels, 3, false, false));

    const author = printedSignatory(text);
    result.signatoryNeedsReview = Boolean(author.needsReview);
    if (author.name) {
      store("signatory", {value: author.name, line: author.line ?? null, evidence: author.evidence || author.name});
      if (!result.fieldEvidence.issuedBy && !result.signatoryNeedsReview) {
        store("issuedBy", {value: author.name, line: author.line ?? null, evidence: author.evidence || author.name});
        result.issuedBySource = "signature";
      }
      if (result.senderOfficeSource !== "printed" && !result.signatoryNeedsReview) {
        result.sender = author.name;
      }
    }
    result.documentType = result.docType;
    result.needsReview = ["controlNo", "date", "recipient", "subject", "sender"].filter(key => !result[key]);
    return result;
  }

  window.PGENRO_OcrFields = Object.freeze({parseDate, parseHeader});
})();
