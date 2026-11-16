(() => {
  "use strict";

  const subjectLabels = "SUBJECT(?: MATTER|\\s*/\\s*PARTICULARS)?|SUBJ\\.?|SUBJEC[I1L]|SUB3ECT|SUBIECT|PAKSA|REGARDING|RE";
  const recipientLabels = "ADDRESSED TO|MEM[O0]RANDUM F[O0]R|RECIPIENT(?: OFFICE)?|SENT TO|T[O0]|F[O0]R|PARA(?: KAY| SA)?";
  const issuerLabels = "S[I1]GN[A]T[O0]RY\\s*/\\s*[I1]SSUED BY|[I1]SSUED BY|[I1]SSUER|[I1]SSU[I1]NG [O0]FF[I1]C[I1]AL|NAME [O0]F (?:THE )?S[I1]GNAT[O0]RY|S[I1]GNAT[O0]RY";
  const issuingOfficeLabels = "[I1]SSU[I1]NG [O0]FF[I1]CE";
  const originLabels = "FR[O0]M|MULA(?: KAY| SA)?|[O0]R[I1]G[I1]NAT[I1]NG [O0]FF[I1]CE";
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
    subjectLabels, "PARTICULARS", recipientLabels, issuerLabels, issuingOfficeLabels, originLabels, senderLabels, controlLabels,
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
  const issuerPlaceholder = /^(?:[-_.=–—]+|[\[(]?(?:SIGNATURE(?: OVER PRINTED NAME)?|SIGNED|S\.?G\.?D\.?)[\])]?[ .:]*)$/i;
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
  const orderHeading = new RegExp("^" + prefix + "((?:OFFICE|SPECIAL|TRAVEL|EXECUTIVE)\\s+ORDER)(?:\\s+(?:N[O0]\\.?|NUMBER|SERIES)\\b.*|\\s*[:#.-]?\\s*\\d.*)?$", "i");
  const bodyStart = /^(?:DEAR|GREETINGS|GOOD (?:DAY|MORNING|AFTERNOON)|SIR|MADAM|MA'AM|TO WHOM|PLEASE|KINDLY|THIS (?:IS|HAS|WILL|REFERS|SERVES|LETTER|MEMO|MEMORANDUM)|WE (?:ARE|WILL|WOULD|REQUEST|HEREBY)|I (?:AM|WOULD|WRITE|HEREBY|RESPECTFULLY)|YOU ARE|THE UNDERSIGNED|IN (?:LIGHT OF|CONNECTION WITH|ACCORDANCE WITH|VIEW OF)|PURSUANT|FOR YOUR (?:INFORMATION|COMPLIANCE|GUIDANCE)|SINCERELY|RESPECTFULLY|YOURS TRULY|BEST REGARDS|MAGANDANG (?:ARAW|UMAGA|HAPON)|MAHAL NA|MANGYARING|PAKIUSAP|KAMI (?:AY|PO)|AKO (?:AY|PO)|KAUGNAY|LUBOS NA GUMAGALANG|IPINAPABATID|NAIS (?:KO|NAMING)|SIGNED BY|SUBMITTED BY|PREPARED BY|APPROVED BY|ANNEX|APPENDIX|COPY FURNISHED)\b/i;
  const headingTypes = ["Request Letter", "Endorsement Letter", "Transmittal Letter", "Response Letter", "Notice of Meeting", "Invitation", "Report"];
  const types = ["Memorandum", "Office Order", "Special Order", "Travel Order", "Executive Order", ...headingTypes, "Letter", "Other Communication"];
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
      if (bodyStart.test(line) || correspondenceClosing.test(line) || correspondenceLabel.test(line)) return lines.slice(0, i);
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

  function memoHeaderIssuer(field) {
    const usable = value => value && !unknownField.test(value) && !issuerPlaceholder.test(value);
    const issuer = field(issuerLabels);
    if (usable(issuer.value)) {
      const person = printedSenderName(issuer.value, true) || printedSenderName(field(issuerLabels, 1).value, true);
      return {...issuer, value: person || issuer.value, source: "printed-issuer"};
    }
    const origin = field(originLabels);
    const author = usable(origin.value) && (printedSenderName(origin.value, true) || printedSenderName(field(originLabels, 1).value, true));
    if (author) return {...origin, value: author, source: "printed-origin-person"};
    const office = field(issuingOfficeLabels);
    if (usable(office.value)) return {...office, source: "printed-office"};
    if (usable(origin.value)) return {...origin, source: "printed-origin-office"};
    return {...issuer, value: "", source: ""};
  }

  function parseHeader(text) {
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
    const issuingOffice = memoHeaderIssuer(field);
    store("issuedBy", issuingOffice);
    result.issuedBySource = issuingOffice.source;
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

    const author = findPrintedSignatory(text);
    result.signatoryNeedsReview = Boolean(author.needsReview);
    if (author.name) {
      store("signatory", {value: author.name, line: author.line ?? null, evidence: author.evidence || author.name});
      if (result.isMemo && author.kind === "signature" &&
          !["printed-issuer", "printed-origin-person"].includes(result.issuedBySource)) {
        store("issuedBy", {value: author.name, line: author.line, evidence: author.evidence});
        result.issuedBySource = "printed-signatory";
      } else if (!result.isMemo && !result.fieldEvidence.issuedBy && !result.signatoryNeedsReview) {
        store("issuedBy", {value: author.name, line: author.line ?? null, evidence: author.evidence || author.name});
        result.issuedBySource = "signature";
      }
      if (result.senderOfficeSource !== "printed" && !result.signatoryNeedsReview) {
        result.sender = author.name;
      }
    }
    result.documentType = result.docType;
    result.needsReview = ["controlNo", "date", "recipient", "subject", "sender"].filter(key => !result[key]);
    if (result.isMemo && (!result.issuedBy || (result.issuedBySource === "printed-signatory" && author.needsReview))) {
      result.needsReview.push("issuedBy");
    }
    return result;
  }

  function reconcileMemoIssuer(text, metadata) {
    if (!metadata.isMemo) return metadata;
    const oldProof = labelOf(tidy((metadata.fieldEvidence?.issuedBy || "").split("\n")[0]));
    const officeLabel = new RegExp("^(?:" + originLabels + "|" + issuingOfficeLabels + ")$", "i");
    const officeOnly = ["printed-office", "printed-origin-office"].includes(metadata.issuedBySource) ||
      (officeLabel.test(oldProof?.[1] || "") && !printedSenderName(metadata.issuedBy, true));
    if (metadata.issuedBy && !officeOnly) return metadata;

    const local = parseHeader(text);
    const hasPrintedPerson = ["printed-issuer", "printed-origin-person", "printed-signatory"].includes(local.issuedBySource);
    const serverHasSigner = metadata.signatorySource === "signature" && metadata.signatory;
    let issuer = local.isMemo && local.issuedBy && (hasPrintedPerson || !metadata.issuedBy) ? {
      value: local.issuedBy, source: local.issuedBySource, evidence: local.fieldEvidence.issuedBy,
      needsReview: local.needsReview.includes("issuedBy"),
    } : null;
    if (serverHasSigner && (!issuer || issuer.source === "printed-signatory")) {
      issuer = {
        value: metadata.signatory, source: "printed-signatory", evidence: metadata.fieldEvidence?.signatory,
        needsReview: metadata.signatoryNeedsReview,
      };
    }
    if (!issuer) return metadata;
    const needsReview = (metadata.needsReview || []).filter(key => key !== "issuedBy");
    if (issuer.needsReview) needsReview.push("issuedBy");
    return {
      ...metadata, issuedBy: issuer.value, issuedBySource: issuer.source, needsReview,
      fieldEvidence: {...metadata.fieldEvidence, issuedBy: issuer.evidence || issuer.value},
    };
  }

  function primaryDocumentPages(rawText='') {
    const pages = String(rawText || "").replace(/\r\n?/g, "\n").split("\f");
    let mainNumber = "";
    const boundary = pages.findIndex((page, index) => {
      const top = page.split("\n").map(tidy).filter(Boolean).slice(0, 6);
      if (index && top.some(line => /^(?:ANNEX|APPENDIX|ATTACHMENT|ENCLOSURE)(?:\s+[A-Z0-9IVX.-]+)?\s*[:.—-]?$/i.test(line))) return true;
      const heading = top.find(line => memoHeading.test(line)) || "";
      const number = heading.match(/\b(?:N[O0]\.?|NUMBER)\s*[:#.-]?\s*([A-Z0-9][A-Z0-9/._-]*)/i)?.[1];
      if (!number || !referenceNumber.test(number)) return false;
      if (!index) mainNumber = number.toLowerCase();
      return Boolean(mainNumber && number.toLowerCase() !== mainNumber);
    });
    return boundary < 0 ? pages : pages.slice(0, boundary);
  }
  const memoClosingAction = "(?:(?:immediate|strict|wide)(?:\\s+and\\s+(?:immediate|strict|wide))?\\s+)?(?:compliance|information|guidance|dissemination|appropriate\\s+action)";
  const correspondenceClosing = new RegExp(
    "^(?:(?:very\\s+)?(?:yours\\s+)?(?:sincerely|respectfully|faithfully|truly)(?:\\s+(?:yours|submitted))?|" +
    "yours\\s+(?:truly|faithfully|sincerely|respectfully)|best\\s+regards|kind\\s+regards|warm\\s+regards|regards|cordially|" +
    "lubos\\s+na\\s+gumagalang|sumasainyo|maraming\\s+salamat|thank\\s+you(?:\\s+very\\s+much)?|" +
    "for\\s+(?:your\\s+)?" + memoClosingAction + "(?:\\s*(?:,\\s*(?:and\\s+)?|\\s+(?:and|or)\\s+)" + memoClosingAction + "){0,3}|" +
    "para\\s+sa\\s+(?:inyong\\s+)?(?:kaalaman|kabatiran|pagsunod)(?:\\s+at\\s+(?:kaalaman|kabatiran|pagsunod))?)\\s*[,.:!]?$", "i"
  );
  const correspondenceRole=/\b(?:PGDH|PGENRO|ENRO|OIC|officer|director|chief|mayor|governor|administrator|supervisor|manager|secretary|secretariat|convener|convenor|focal\s+person|head|president|chairperson|chairman|coordinator|principal|teacher|engineer|treasurer|representative|proprietor|owner|student|applicant|dean|professor|specialist|staff|assistant|councilor|registrar|librarian|consultant|aide|clerk|accountant|auditor|analyst|superintendent|rector|pastor|lawyer|pangulo|kalihim|tagapangulo|kagawad|kapitan|punong\s+barangay)\b|^[A-Z]{2,}[#?]?(?:[-/][A-Z]{2,})+$/i;
  const correspondenceLabel=/^(?:signed(?:\s+by)?|signatory(?:\s*\/\s*issued\s+by)?|written\s+by|authored\s+by|issued\s+by|notice\s+from|convened\s+by|submitted\s+by|prepared\s+by|approved\s+by|noted\s+by|certified\s+by|reviewed\s+by|checked\s+by|received\s+by|acknowledged\s+by|recommending\s+approval|respectfully\s+submitted\s+by|name\s+of\s+(?:sender|signatory)|nilagdaan\s+ni|inihanda\s+ni|inaprubahan\s+ni)\s*[:\uff1a-]?\s*(.*)$/i;
  const correspondenceBody=/^(?:DEAR|GREETINGS|SIR|MADAM|MA'AM|TO\s+WHOM|PLEASE|KINDLY|THIS\s+(?:IS|HAS|WILL|REFERS)|WE\s+(?:ARE|WILL|WOULD|REQUEST)|I\s+(?:AM|WOULD)|YOU\s+ARE|THE\s+UNDERSIGNED|IN\s+(?:LIGHT\s+OF|CONNECTION\s+WITH)|PURSUANT\s+TO|FOR\s+YOUR\s+(?:INFORMATION|COMPLIANCE)|SINCERELY|RESPECTFULLY|MAGANDANG\s+(?:ARAW|UMAGA|HAPON)|MAHAL\s+NA|MANGYARING|PAKIUSAP|KAMI\s+(?:AY|PO)|AKO\s+(?:AY|PO)|KAUGNAY|LUBOS\s+NA\s+GUMAGALANG)\b/i;
  const tidyCorrespondence=s=>String(s||'').normalize('NFC').replace(/\s+/g,' ').trim();
  const senderFields='RECEIVED\\s+FROM|FROM|SENDER|MULA(?:\\s+(?:KAY|SA))?|SENT\\s+BY|ORIGINATOR|ORIGINATED\\s+BY|AUTHOR|AUTHORED\\s+BY|WRITTEN\\s+BY|ISSUED\\s+BY|NOTICE\\s+FROM|CONVENED\\s+BY|TRANSMITTED\\s+BY|ENDORSED\\s+BY|REQUESTED\\s+BY';
  const senderField=new RegExp(`^(?:${senderFields})(?:\\s*[:：;–—-]\\s*|[ \\t]+)(.*)$`,'i');
  const senderBare=new RegExp(`^(?:${senderFields})\\s*[:：;]?$`,'i');
  const senderMark=/^(?:\(\s*(?:s\.?g\.?d\.?|signed|signature)\s*\)|s\.?g\.?d\.?|\/s\/|e[- ]?signed(?:\s+by)?|digitally\s+signed\s+by|signed\s+(?:by|electronically\s+by)|signature\s+(?:over\s+printed\s+name|of)|printed\s+name|pangalan\s+at\s+lagda|nilagdaan\s+ni)\s*[:：,–—-]?\s*(.*)$/i;
  const senderContact=/^(?:TEL(?:EPHONE)?|PHONE|CONTACT|MOBILE|FAX|WWW\.|E-?MAIL|PAGE\b|REV\.?\s+NO|DOCUMENT\s+CODE)|@|https?:\/\//i;
  const senderNonName=/\b(?:national|environment|natural|resources|college|school|university|institute|institution|foundation|corporation|company|association|cooperative|agency|committee|secretariat|team|unit|bureau|commission|authority|republic|province|provincial|municipal|regional|district|government|office|department|division|subject|memorandum|notice|meeting|report|document|reference|control|end|signature|remarks|status|dear|thank|please|request|hereby|attached|enclosed|address|telephone|email|contact|mobile|fax|street|road|avenue|barangay|brgy|city|municipality|center|centre|metro|disaster|risk|management|operations|services|council|members|participants|personnel|regards|copy|cc|page|for|to|from|education|health|planning|workshop|agenda|attendance|schedule|venue|date|time|location|activity|program|event|safety|training|session|annual|quarterly|project|inc|ltd|everyone|see|you|all|welcome|regards|regarding|compliance|information|attention)\b/i;
  const senderTitles='Mr|Mrs|Ms|Miss|Dr|Dra|Atty|Attorney|Engr|Engineer|EnP|Hon|Prof|Professor|Rev|Fr|Bro|Sis|Gov|Governor|Mayor|Dir|Director|Capt|Col|Gen|Lt|Major';
  const senderCredentials='Ph\\.?D\\.?|Ed\\.?D\\.?|DPA|DMD|M\\.?D\\.?|MBA|MPA|MAEd|MSc|MA|MS|CPA|RN|LPT|RGC|RMT|RPh|RCE|RME|REE|CESO(?:\\s+[IVX]+)?|EnP|LLB|JD';
  const senderHeaderLabels='SUBJECT(?:\\s+MATTER)?|SUBJ(?:EC[TIL1]|\\.)?|SUB3ECT|RE|REGARDING|PAKSA|ADDRESSED\\s+TO|MEMORANDUM\\s+FOR|RECIPIENT(?:\\s+OFFICE)?|RECEIVED\\s+FROM|SENDER|FROM|MULA(?:\\s+(?:KAY|SA))?|PARA(?:\\s+(?:KAY|SA))?|ISSUED\\s+BY|ISSUING\\s+OFFICE|ORIGINATING\\s+OFFICE|SIGNATORY|DATE\\s+(?:RECEIVED|RELEASED|ISSUED)|(?:RECEIVED|RELEASED)\\s+DATE|DATED|DATE|TO|T0|FOR|PETSA|THROUGH|THRU|CC|ATTACHMENTS?|ENCLOSURES?|(?:DOCUMENT\\s+)?(?:CONTROL|TRACKING)(?:\\s*(?:NO\\.?|NUMBER|#))?|REFERENCE(?:\\s+(?:NO\\.?|NUMBER))?|REF(?:\\.?\\s*(?:NO\\.?|NUMBER))?|DOCUMENT\\s+TYPE|COMMUNICATION\\s+TYPE|DIRECTION|STATUS|ACTION\\s+TAKEN|DATE\\s+FORWARDED|REMARKS';
  const senderHeaderField=new RegExp(`^(${senderHeaderLabels})\\s*(?:[:：;]|[–—-])\\s*(.*)$`,'i');
  const senderHeaderBare=new RegExp(`^(?:${senderHeaderLabels})\\s*[:：;]?\\s*$`,'i');
  const senderMemoHeading=/^(?:[A-Z][A-Z0-9&./-]*\s+){0,6}(?:MEMORANDUM|MEM0RANDUM|MEMO)(?:\s+(?:ORDER|CIRCULAR))?(?:\s+(?:N[O0]\.?|NUMBER|FOR|SERIES)\b.*|\s*[:#.-]?\s*\d.*)?$/i;
  function splitSignatureNameRole(value) {
   const s=tidyCorrespondence(value),paren=s.match(/\s*\(([^()]*)\)\s*$/);
   const labelledRole=s.match(/^([^:：]{2,65})\s*[:：]\s*(.+)$/);if(labelledRole&&correspondenceRole.test(labelledRole[1]))return [labelledRole[2].trim(),labelledRole[1].trim()];
   if(paren&&correspondenceRole.test(paren[1]))return [s.slice(0,paren.index).trim(),paren[1].trim()];
   const separators=[...s.matchAll(/\s*[|,]\s*|\s+[-–—]\s+/g)];
   for(let i=0;i<separators.length;i++){
    const m=separators[i],end=separators[i+1]?.index??s.length,start=m.index+m[0].length;
    if(correspondenceRole.test(s.slice(start,end)))return [s.slice(0,m.index).trim(),s.slice(start).trim()];
   }
   const trailingRole=s.match(/\s+(?:(?:Acting|Assistant|Deputy|Municipal|Provincial|City|Regional|District|Division|Department|Administrative|School|General|Executive|Senior|Junior)\s+)*(?:PGDH(?:[-/][A-Z]+)?|PGENRO|ENRO|OIC|Officer|Director|Chief|Manager|Mayor|Governor|President|Secretary|Chairperson|Chairman|Coordinator|Principal|Superintendent|Engineer|Treasurer|Administrator|Clerk|Aide|Registrar|Librarian|Head)\b/i);
   if(trailingRole&&s.slice(0,trailingRole.index).trim().split(/\s+/).length>=2)return [s.slice(0,trailingRole.index).trim(),s.slice(trailingRole.index).trim()];
   return [s,''];
  }
  function senderNameKey(value) {
   return String(value).replace(new RegExp(`^(?:(?:${senderTitles})\\.?\\s+)+`,'i'),'').replace(new RegExp(`,?\\s+(?:${senderCredentials})(?:[,\\s].*)?$`,'i'),'').normalize('NFC').toLocaleLowerCase().replace(/[^\p{L}\p{N}_]/gu,'');
  }
  function senderInkSpacing(value) {
   // Keep readable letters; restore only the boundary before a middle initial.
   return value.replace(/(?<=\p{L})\s*[?*|_~]+\s*(?=[A-Z]\.\s*\p{L})/gu,' ');
  }
  function printedSenderName(value,contextual=false) {
   let s=tidyCorrespondence(value),mark=s.match(senderMark);if(mark)s=mark[1];
   s=s.replace(/^by\s*:\s*/i,'').replace(/^[|:_\-\s"“”]+|[|:_\-\s"“”]+$/g,'');
   [s]=splitSignatureNameRole(s);const inkCleanup=contextual&&senderInkSpacing(s)!==s;if(contextual)s=senderInkSpacing(s);s=s.replace(new RegExp(`^(${senderTitles})\\.(?=\\p{L})`,'iu'),'$1. ');
   if(s.length<4||s.length>120||/[\d@:/;!?()]/.test(s)||correspondenceBody.test(s)||correspondenceClosing.test(s))return '';
   let base=s.replace(new RegExp(`^(?:(?:${senderTitles})\\.?\\s+)+`,'i'),'').replace(new RegExp(`,?\\s+(?:${senderCredentials})(?:[,\\s].*)?$`,'i'),'');
   if(senderNonName.test(base)||correspondenceRole.test(base))return '';
   const words=base.replace(/,/g,' ').trim().split(/\s+/),particles=new Set(['de','del','dela','la','las','los','da','dos','di','du','van','von','bin','al','y','san','santa']),suffixes=new Set(['jr','sr','ii','iii','iv','v']);
   if(words.length<2||words.length>9)return '';
   const particle=w=>particles.has(w.toLocaleLowerCase().replace(/\./g,''))||suffixes.has(w.toLocaleLowerCase().replace(/\./g,''));
   // Mixed lowercase debris is not a reliable printed name. Keep uniformly lowercase labeled names.
   if((!contextual||inkCleanup||base!==base.toLocaleLowerCase())&&words.some(w=>!particle(w)&&!/^\p{Lu}/u.test(w)))return '';
   const lengths=words.map(w=>(w.match(/\p{L}/gu)||[]).length),substantive=words.map((w,i)=>particle(w)?-1:i).filter(i=>i>=0);
   const initials=substantive.length&&lengths[substantive.at(-1)]>1&&substantive.slice(0,-1).every(i=>lengths[i]===1);
   if(substantive.length<2||(substantive.filter(i=>lengths[i]>1).length<2&&!initials)||words.some(w=>!/^[\p{L}.'’-]+$/u.test(w)))return '';
   return s.replace(/\.{2,}/g,'.').replace(/(?<=\s)([A-Z])(?=\s)/g,'$1.');
  }
  function senderEntries(rawText) {
   rawText=String(rawText||'').replace(/^((?:(?:very\s+)?(?:yours\s+)?(?:sincerely|respectfully|faithfully|truly)(?:\s+(?:yours|submitted))?|yours\s+(?:truly|faithfully|sincerely|respectfully)|best\s+regards|kind\s+regards|lubos\s+na\s+gumagalang))[,.:][ \t]+(?=\p{L})/gimu,'$1,\n');
   const entries=[];let excluded=false;
   for(const [p,page] of primaryDocumentPages(rawText).entries()){
    page.split('\n').forEach((raw,line)=>{
     raw=raw.replace(new RegExp(`[ \\t]{2,}(?=(?:${senderHeaderLabels}|${senderFields})\\s*[:：;])`,'gi'),'\n');
     for(const cell of raw.split('\n')){
      if(/^\s*(?:CC\s*:|COPY\s+(?:TO|FURNISHED)|ANNEX\b|APPENDIX\b|ATTACHMENTS?\s*:|ENCLOSURES?\s*:)/i.test(cell))excluded=true;
      const text=tidyCorrespondence(cell);if(text)entries.push({text,raw:cell.trim(),page:p+1,line:line+1,excluded});
     }
    });
   }
   return entries;
  }
  function senderBodyLine(value) {
   if(correspondenceClosing.test(value)||senderHeaderField.test(value)||senderHeaderBare.test(value)||correspondenceLabel.test(value)||senderMark.test(value))return false;
   if(correspondenceBody.test(value))return true;
   const words=value.split(/\s+/);return Boolean(((words.length>=6&&/[.!?]$/.test(value))||words.length>=10)&&/\p{Ll}/u.test(value)&&!correspondenceRole.test(value));
  }
  function scanPrintedSignatories(rawText='',signatureRegion=false) {
   const entries=senderEntries(rawText),candidates=[],consumed=new Set();
   const firstBody=entries.findIndex(e=>senderBodyLine(e.text)),greeting=entries.findIndex(e=>/^DEAR\b|^(?:SIR|MADAM|MA.AM)\s*[:,]/i.test(e.text));
   const compact=entries.length>0&&entries.length<=6&&!entries.some(e=>senderHeaderField.test(e.text)||senderHeaderBare.test(e.text)||correspondenceBody.test(e.text)||parseDate(e.text));
   function roleAt(index,step,page){
    const parts=[];
    for(let j=index;step>0?j<index+step*3:j>index+step*3;j+=step){
     if(j<0||j>=entries.length)break;
     const e=entries[j],s=e.text;
     if(e.page!==page||e.excluded||senderHeaderField.test(s)||senderHeaderBare.test(s)||correspondenceLabel.test(s)||senderMark.test(s)||correspondenceBody.test(s)||correspondenceClosing.test(s)||printedSenderName(s)||senderContact.test(s))break;
     if(s.length>120||s.split(/\s+/).length>18||/\d{3}/.test(s)||(s.split(/\s+/).length>7&&/[.!?]$/.test(s)))break;
     if(step>0)parts.push(s);else parts.unshift(s);if(correspondenceRole.test(parts.join(' ')))return parts.join(' ');
    }
    return '';
   }
   function add(name,role,entry,score,kind,evidence,inkCleanup=false){
    const candidate={name,role,page:entry.page,line:entry.line,score,kind,evidence,inkCleanup,confidence:inkCleanup?'low':score>=100?'high':'medium'},key=senderNameKey(name),prior=candidates.find(c=>senderNameKey(c.name)===key);
    if(!prior)candidates.push(candidate);else if(score>prior.score)Object.assign(prior,candidate);
   }
   for(let i=0;i<entries.length;i++){
    const entry=entries[i];if(entry.excluded||consumed.has(i))continue;
    const s=entry.text,field=entry.raw.match(senderField),bare=senderBare.test(s),label=s.match(correspondenceLabel),mark=s.match(senderMark);
    const explicit=Boolean((field||bare)&&(firstBody<0||i<firstBody||/^(?:AUTHOR|AUTHORED|WRITTEN|ISSUED|NOTICE|CONVENED)\b/i.test(s)));
    let anchor=null;
    for(let j=i-1;j>Math.max(-1,i-7);j--){
     const previous=entries[j];if(previous.page!==entry.page||previous.excluded)break;
     if(correspondenceClosing.test(previous.text)||correspondenceLabel.test(previous.text)||senderMark.test(previous.text)){anchor=previous;break;}
     if(printedSenderName(previous.text)||senderHeaderField.test(previous.text)||correspondenceBody.test(previous.text)||previous.text.split(/\s+/).length>18)break;
    }
    const context=Boolean(explicit||label||mark||anchor);let rawName=explicit?(field?.[1]||''):label?label[1]:mark?mark[1]:entry.raw,index=i;
    if((explicit||label||mark)&&!rawName){index=i+1;if(index>=entries.length||entries[index].page!==entry.page||entries[index].excluded||senderHeaderField.test(entries[index].text)||correspondenceLabel.test(entries[index].text))continue;rawName=entries[index].text;}
    if(explicit&&!printedSenderName(rawName,true)){
     for(let probe=index+1;probe<Math.min(entries.length,index+5);probe++){
      const e=entries[probe];if(e.page!==entry.page||e.excluded||senderHeaderField.test(e.text)||senderHeaderBare.test(e.text)||correspondenceBody.test(e.text)||correspondenceClosing.test(e.text)||correspondenceLabel.test(e.text))break;
      if(printedSenderName(e.text,true)){index=probe;rawName=e.text;break;}
     }
    }
    const columns=rawName.split(/[ \t]{2,}|\s+\|\s+/),columnNames=columns.map(part=>printedSenderName(part,context||signatureRegion||(firstBody>=0&&index>firstBody)));
    if(columns.length>1&&columnNames.every(Boolean)&&(context||signatureRegion||(firstBody>=0&&index>firstBody))){columnNames.forEach((columnName,column)=>add(columnName,'',entries[index],explicit?130:anchor?110:78,explicit?'explicit-sender':'footer-name',s,senderInkSpacing(columns[column])!==columns[column]));if(index!==i)consumed.add(index);continue;}
    const [inlineName,inlineRole]=splitSignatureNameRole(rawName),nearbyRole=inlineRole||roleAt(index+1,1,entry.page)||roleAt(index-1,-1,entry.page);
    let name=printedSenderName(rawName,context||Boolean(nearbyRole)||signatureRegion),nextIndex=index+1;
    if(nextIndex<entries.length&&entries[nextIndex].page===entry.page&&!entries[nextIndex].excluded){
     const surname=entries[nextIndex],shortSurname=surname.text.split(/\s+/).length===1||/^(?:DE|DEL|DELA|VAN|VON)\s+\S+$/i.test(surname.text);
     if(shortSurname&&!correspondenceRole.test(surname.text)&&!senderHeaderField.test(surname.text)&&!correspondenceLabel.test(surname.text)&&inlineName.split(/\s+/).length<=3&&roleAt(nextIndex+1,1,entry.page)){
      const joined=printedSenderName(inlineName+' '+surname.text,context);if(joined){name=joined;nextIndex++;consumed.add(index+1);}
     }
    }
    if(!name)continue;
    const role=inlineRole||roleAt(nextIndex,1,entry.page)||roleAt(index-1,-1,entry.page);
    if(!context){
     if((greeting>=0&&index<greeting)||(firstBody>=0&&index<firstBody))continue;
     const laterHeader=entries.slice(nextIndex,nextIndex+8).some(e=>!e.excluded&&e.page===entry.page&&(senderHeaderField.test(e.text)||senderHeaderBare.test(e.text)||senderMemoHeading.test(e.text)||/^NOTICE\s+OF\s+MEETING\b/i.test(e.text)||parseDate(e.text)));
     if(firstBody<0&&laterHeader)continue;
     const previousField=entries.slice(0,index).reverse().find(e=>e.page===entry.page&&(senderHeaderField.test(e.text)||senderHeaderBare.test(e.text))),fieldIndex=entries.indexOf(previousField);
     if(previousField&&/^(?:TO|T0|FOR|PARA|RECIPIENT|ADDRESSED|SUBJECT|SUBJ|PAKSA|THRU|THROUGH|ATTN|ATTENTION)\b/i.test(previousField.text)&&index-fieldIndex<=8&&!entries.slice(fieldIndex+1,index).some(e=>correspondenceBody.test(e.text)||e.text.split(/\s+/).length>6||(/[.!?]$/.test(e.text)&&!printedSenderName(e.text)))&&entry.line-previousField.line<=index-fieldIndex)continue;
    }
    const meaningfulAfter=entries.slice(nextIndex).filter(e=>!e.excluded&&!senderContact.test(e.text)&&!/^[-_=\s]+$/.test(e.text)),contentBefore=(firstBody>=0&&index>firstBody)||entries.slice(0,index).some(e=>senderHeaderField.test(e.text)||senderHeaderBare.test(e.text));
    let score,kind;
    if(explicit){score=130;kind='explicit-sender';}
    else if(label||(mark&&mark[1])||(anchor&&senderMark.test(anchor.text))){score=120;kind='signature';}
    else if(anchor){score=110;kind='signature';}
    else if(role&&(contentBefore||signatureRegion||compact)){score=90;kind='signature';}
    else if((!meaningfulAfter.length||meaningfulAfter.every(e=>printedSenderName(e.text)))&&(contentBefore||signatureRegion||compact)&&!role){score=78;kind='footer-name';}
    else continue;
    const markerText=label?s:anchor?.text||'';
    if(/^(?:prepared|submitted|respectfully\s+submitted|inihanda)\b/i.test(markerText)){score=85;kind='prepared-by';}
    else if(/^(?:noted|certified|reviewed|checked|received|acknowledged|recommending)\b/i.test(markerText)){score=55;kind='supporting';}
    else if(/^(?:approved|inaprubahan)\b/i.test(markerText)){score=65;kind='approval';}
    const inkCleanup=senderInkSpacing(inlineName)!==inlineName,proof=[...new Set([explicit||label||mark?s:anchor?.text||'',inkCleanup?inlineName:name,role].filter(Boolean))].join('\n');
    add(name,role,entries[index],score,kind,proof,inkCleanup);if(index!==i)consumed.add(index);
   }
   candidates.sort((a,b)=>b.score-a.score||a.page-b.page||a.line-b.line);
   const eligible=candidates.filter(c=>c.kind!=='supporting'),primary=eligible.filter(c=>eligible[0].score-c.score<10),selected=primary.length===1?primary[0]:null;
   return {entries,candidates,primary,selected,signatory:selected};
  }

  function letterRecipient(text) {
    const lines=String(text).split('\f')[0].split('\n').map(tidyCorrespondence),greeting=lines.findIndex(line=>/^Dear\b|^(?:Sir|Madam|Ma.am)\s*[:,]/i.test(line));
    if(greeting>=0){
     const block=[];
     for(const line of lines.slice(Math.max(0,greeting-10),greeting).reverse()){
      if(!line){if(block.length)break;continue;}
      if(senderHeaderField.test(line)||senderHeaderBare.test(line)||parseDate(line))break;
      block.unshift(line);
     }
     const start=block.findIndex(line=>printedSenderName(line));
     if(start>=0&&block.slice(start+1).some(line=>correspondenceRole.test(line)||/\b(?:OFFICE|DEPARTMENT|DIVISION|UNIVERSITY|COLLEGE|SCHOOL)\b/i.test(line))){
      return block.slice(start).join(' ');
     }
    }
    return '';
  }

  function findPrintedSignatory(text, signatureRegion = false) {
    const scan = scanPrintedSignatories(text, signatureRegion);
    const signatures = scan.candidates.filter(candidate => candidate.kind === "signature");
    if (signatures.length > 1) return {name: "", needsReview: true, ambiguous: true};
    const author = signatures[0] || scan.selected;
    if (!author) return {name: "", needsReview: scan.primary.length > 1, ambiguous: scan.primary.length > 1};
    return {...author, needsReview: author.inkCleanup || author.score < 90, ambiguous: false};
  }

  function appendSignatureEvidence(text, signer) {
    if (signer.kind !== "signature" || !signer.evidence) return text;
    const existing = new Set(text.split("\n").map(line => tidy(line).toLowerCase()));
    const lines = signer.evidence.split("\n").filter(line => !existing.has(tidy(line).toLowerCase()) ||
      (correspondenceClosing.test(line) || senderMark.test(line) || correspondenceLabel.test(line)));
    if (!lines.length) return text;
    const tail = text.match(/^\s*(?:CC\s*:|COPY\s+(?:TO|FURNISHED)|ANNEX\b|APPENDIX\b|ATTACHMENTS?\s*:|ENCLOSURES?\s*:)/im);
    const end = tail?.index ?? text.length;
    return text.slice(0, end).trimEnd() + "\n\n" + lines.join("\n") + "\n\n" + text.slice(end);
  }

  window.PGENRO_OcrFields = Object.freeze({
    parseDate, parseHeader, reconcileMemoIssuer, scanPrintedSignatories, findPrintedSignatory, appendSignatureEvidence,
    printedSenderName, senderNameKey, letterRecipient,
  });
})();
