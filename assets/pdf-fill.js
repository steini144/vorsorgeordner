(function (root) {
  'use strict';

  const titles = { power: 'Vorsorgevollmacht', care: 'Betreuungsverfügung', patient: 'Patientenverfügung' };
  const decode = base64 => Uint8Array.from(root.atob(base64), char => char.charCodeAt(0));

  function wrap(text, width, font, size) {
    const lines = [];
    for (const paragraph of String(text).replace(/\r\n?/g, '\n').split('\n')) {
      let line = '';
      for (const word of paragraph.split(/\s+/).filter(Boolean)) {
        if (line && font.widthOfTextAtSize(`${line} ${word}`, size) > width) {
          lines.push(line); line = '';
        }
        for (const char of `${line ? ' ' : ''}${word}`) {
          if (line && font.widthOfTextAtSize(line + char, size) > width) {
            lines.push(line); line = '';
          }
          line += char;
        }
      }
      lines.push(line);
    }
    return lines;
  }

  async function fill(docKey, entries = {}) {
    if (!titles[docKey] || !root.PDFLib || !root.fontkit || !root.VORSORGE_PDF_FONT) {
      throw new Error('Die PDF-Funktion konnte nicht geladen werden. Bitte öffne die Website mit ihrem assets-Ordner.');
    }
    const { PDFDocument, rgb } = root.PDFLib;
    const pdf = await PDFDocument.load(root.VORSORGE_BUNDLED_PDFS[docKey]);
    pdf.registerFontkit(root.fontkit);
    const font = await pdf.embedFont(decode(root.VORSORGE_PDF_FONT), { subset: false });
    const form = pdf.getForm();
    const consumed = new Set();
    const supplements = [];
    const value = key => {
      consumed.add(key);
      const entry = entries[key];
      const raw = entry && typeof entry === 'object' && 'value' in entry ? entry.value : entry;
      return typeof raw === 'boolean' ? raw : String(raw ?? '').trim();
    };
    const label = (key, fallback) => entries[key]?.label || fallback || key;
    const extra = (heading, text) => {
      if (text && text !== 'Keine Angabe') supplements.push({ heading, text: String(text) });
    };
    const check = (name, selected) => {
      const field = form.getCheckBox(name);
      if (selected) field.check(); else field.uncheck();
    };
    const choose = (key, options) => {
      const selected = value(key);
      for (const [option, names] of Object.entries(options)) {
        for (const name of [].concat(names)) check(name, selected === option);
      }
      return selected;
    };
    function put(names, text, heading) {
      names = [].concat(names);
      if (!text) return;
      const fields = names.map(name => form.getTextField(name));
      for (const field of fields) {
        if (!field.acroField.getDefaultAppearance()) field.acroField.setDefaultAppearance(`0 g /${font.name} 10 Tf`);
        if (field.acroField.getWidgets()[0].getRectangle().height > 35) field.enableMultiline();
      }
      let size = 10;
      const widths = fields.map(field => field.acroField.getWidgets()[0].getRectangle().width - 6);
      const capacities = fields.map(field => {
        const rect = field.acroField.getWidgets()[0].getRectangle();
        return field.isMultiline() ? Math.max(1, Math.floor((rect.height - 6) / (font.heightAtSize(size) * 1.2))) : 1;
      });
      if (fields.length === 1 && capacities[0] === 1) {
        const measured = font.widthOfTextAtSize(String(text).replace(/\n/g, ' '), size);
        size = Math.max(8, Math.min(size, size * widths[0] / Math.max(measured, 1)));
      }
      let lines = wrap(text, Math.min(...widths), font, size);
      if (lines.length > capacities.reduce((sum, count) => sum + count, 0)) {
        extra(heading, text);
        lines = ['Siehe Ergänzungsblatt'];
      }
      fields.forEach((field, index) => {
        field.removeMaxLength();
        field.setFontSize(size);
        field.setText(lines.splice(0, capacities[index]).join('\n'));
      });
    }
    const text = (key, names, heading) => put(names, value(key), heading || label(key));
    const join = (...parts) => parts.filter(Boolean).join(' · ');
    const location = () => join(value('signingPlace'), value('signingDate'));

    if (docKey === 'power') {
      for (const [prefix, names] of [
        ['grantor', [37, 38, 39, 48, 41]], ['agent', [42, 43, 44, 45, 46]]
      ]) {
        ['Name', 'BirthDate', 'BirthPlace', 'Address'].forEach((suffix, index) => {
          text(prefix + suffix, `Textfeld ${names[index]}`);
        });
        put(`Textfeld ${names[4]}`, join(value(prefix + 'Phone'), value(prefix + 'Email')), prefix === 'grantor' ? 'Kontakt Vollmachtgeber/in' : 'Kontakt bevollmächtigte Person');
      }
      const keys = ['healthCare', 'seriousTreatment', 'medicalRecords', 'coerciveAccommodation', 'coerciveMeasures', 'forcedTreatment', 'hospitalForTreatment', 'determineResidence', 'endTenancy', 'newTenancy', 'careContract', 'authorities', 'manageAssets', 'disposeAssets', 'receivePayments', 'incurLiabilities', 'banking', 'gifts', 'mailAndTelecom', 'courtRepresentation', 'subPower', 'guardianIfNeeded', 'beyondDeath'];
      keys.forEach((key, index) => choose(key, { Ja: `Kontrollkästchen ${2 * index + 1}`, Nein: `Kontrollkästchen ${2 * index + 2}` }));
      text('excludedTransactions', ['Textfeld 6', 'Textfeld 7']);
      text('additionalRules', 'Textfeld 8');
      const place = location();
      put('Textfeld 9', place, 'Ort und Datum');
      put('Textfeld 11', place, 'Ort und Datum');
      extra('Eingetragener Name der Vollmachtgeberin / des Vollmachtgebers (Unterschrift ergänzen)', value('grantorSignatureName'));
      extra('Eingetragener Name der bevollmächtigten Person (Unterschrift ergänzen)', value('agentSignatureName'));
    }

    if (docKey === 'care') {
      for (const [prefix, names] of [
        ['person', [12, 13, 14, 15, 16]], ['preferred', [17, 18, 19, 20, 21]],
        ['alternate', [24, 25, 26, 22, 23]], ['excluded', [29, 30, 31, 27, 28]]
      ]) {
        ['Name', 'BirthDate', 'BirthPlace', 'Address'].forEach((suffix, index) => text(prefix + suffix, `Textfeld ${names[index]}`));
        const contact = prefix === 'person' ? join(value('personPhone'), value('personEmail')) : value(prefix + 'Contact');
        put(`Textfeld ${names[4]}`, contact, `Kontaktdaten ${valueName(prefix)}`);
      }
      [32, 33, 34, 35].forEach((number, index) => text(`wish${index + 1}`, `Textfeld ${number}`, `Wunsch ${index + 1}`));
      put('Textfeld 36', location(), 'Ort und Datum');
      extra('Eingetragener Name (Unterschrift ergänzen)', value('signatureName'));
    }

    if (docKey === 'patient') {
      const map = { firstName: 'Text38', lastName: 'Text39', birthDate: 'Text40', postalCodeCity: 'Text41', street: 'Text42', phone: 'Text43' };
      for (const [key, name] of Object.entries(map)) text(key, name);
      text('motivation', ['Text44', 'Text45', 'Text46', 'Text47', 'Text48', 'Text49', 'Text50']);
      for (const [key, name] of Object.entries({
        situationDying: 'mich nach ärztlicher Erkenntnis aller', situationTerminalIllness: 'mich im Endstadium eines unheilbaren',
        situationBrainDamage: 'infolge einer Gehirnschädigung meine', situationDementia: 'mich im Zustand eines weit fortgeschrit',
        situationMultimorbidity: 'von einer Vielzahl von Krankheiten', placeFamiliar: 'wenn möglich in meiner vertrauten Um',
        placeHospice: 'wenn möglich in ein Hospiz verlegt zu', placeCareFacility: 'wenn möglich in eine Pflegeeinrichtung',
        placeHospital: 'wenn möglich ins Krankenhaus verlegt', avoidFamiliar: 'nicht in meiner vertrauten Umgebung zu',
        avoidHospice: 'nicht in ein Hospiz verlegt zu werden', avoidCareFacility: 'wenn möglich nicht in eine Pflegeein',
        avoidHospital: 'wenn möglich nicht ins Krankenhaus', palliativeTeam: 'die Betreuung durch ein Palliativteam',
        pastoralCare: 'seelsorgliche Begleitung zu erhalten', anointing: 'als katholische Christinkatholischer'
      })) check(name, value(key) === true);
      const situations = value('otherSituations');
      check('Kontrollkästchen1', Boolean(situations));
      put(['Text52', 'Text53', 'Text54', 'Text55'], situations, 'Weitere Situationen');
      choose('sedation', { 'Zulassen, wenn sonstige Möglichkeiten versagen': 'lasse ich zu', 'Nicht zulassen': 'lehne ich ab' });
      choose('artificialNutrition', { 'Beginn oder Fortführung zur Lebensverlängerung': 'dass eine künstliche Ernährung begon', 'Unterlassen oder Beenden': 'die Unterlassung bzw Einstellung einer' });
      choose('artificialFluids', { 'Beginn oder Fortführung zur Lebensverlängerung': 'dass eine künstliche Flüssigkeitszufuhr', 'Unterlassen oder Beenden': 'die Unterlassung bzw Einstellung einer_2' });
      choose('ventilation', { 'Nicht-invasive Beatmung zur Lebensverlängerung': 'eine künstliche Beatmung mit dem Ziel', 'Invasive Beatmung zur Lebensverlängerung': 'eine künstliche Beatmng', 'Keine Beatmung bzw. Beenden einer Beatmung bei Linderung der Luftnot': 'dass keine künstliche Beatmung durch' });
      choose('dialysis', { 'Durchführen zur Lebensverlängerung': 'eine künstliche Blutwäsche Dialyse mit', 'Nicht durchführen bzw. beenden': 'dass keine Dialyse durchgeführt bzw' });
      choose('antibiotics', { 'Zur Lebensverlängerung': 'Antibiotika mit dem Ziel mein Leben zu', 'Keine Behandlung, außer zur Beschwerdelinderung': 'dass keine Behandlung mit Antibiotika' });
      choose('bloodProducts', { 'Gabe zur Lebensverlängerung': 'die Gabe von Blut oder Blutbestandteilen', 'Keine Gabe': 'keine Gabe von Blut oder Blutbestand' });
      choose('circulatoryMedication', { 'Gabe zur Lebensverlängerung': 'die Gabe von kreislaufstabilisierenden', 'Keine Gabe': 'keine Gabe von kreislaufstabilisierenden' });
      choose('resuscitation', { 'Versuche zur Lebensverlängerung': 'in jedem Fall Versuche der Wieder', 'Keine Wiederbelebung': 'die Unterlassung von Versuchen zur' });
      const medicalNotes = ['symptomRelief', 'symptomReliefNotes', 'medicalAdditions'].map(key => {
        const entered = value(key);
        return entered && entered !== 'Keine Angabe' ? `${label(key)}: ${entered}` : '';
      }).filter(Boolean).join('\n');
      put(['Text59', 'Text60', 'Text61', 'Text62'], medicalNotes, 'Ergänzungen zu medizinischen Maßnahmen');
      const donation = choose('organDonation', { 'Ich stimme zu': 'Ich stimme einer Entnahme meiner Organe' });
      if (donation === 'Ich stimme nicht zu') {
        const page = pdf.getPage(3);
        page.drawLine({ start: { x: 57, y: 620 }, end: { x: 558, y: 495 }, thickness: 1, color: rgb(0.2, 0.2, 0.2) });
        page.drawLine({ start: { x: 57, y: 495 }, end: { x: 558, y: 620 }, thickness: 1, color: rgb(0.2, 0.2, 0.2) });
        const note = form.createTextField('website.organDonation');
        note.setText('Keine Zustimmung zur Organspende');
        note.addToPage(page, { x: 62, y: 479, width: 490, height: 14, font, borderWidth: 0 });
        note.setFontSize(9.5);
      }
      const companions = value('companions');
      check('von folgenden mir nahestehenden', Boolean(companions));
      put('Text63', companions, 'Gewünschte Begleitung');
      const excluded = value('excludedCompanions');
      check('von folgenden Personen nicht begleitet', Boolean(excluded));
      put('Text64', excluded, 'Nicht gewünschte Begleitung');
      text('accompanimentNotes', ['Text66', 'Text67', 'Text68', 'Text69']);
      text('hearPersons', 'Text70', 'Anzuhörende Angehörige und Vertrauenspersonen');
      text('excludeHearPersons', 'Text76', 'Nicht anzuhörende Personen');
      choose('gesturesChangeWill', { 'Keine Änderung meines Willens unterstellen': 'Ich wünsche nicht dass in einer unter', 'Aktuellen Willen unter Einbezug aller Beteiligten ermitteln': 'Wenn ich meine Patientenverfügung' });
      choose('hasPowerOfAttorney', { Ja: 'Ich habe zusätzlich zur Patientenverfü', Nein: 'Ich habe keine Vorsorgevollmacht' });
      text('authorizedPersons', 'Text90', 'Bevollmächtigte Personen und Kontaktdaten');
      choose('hasCareDirective', { Ja: 'Ich habe zusätzlich zur Patientenverfü_2', Nein: 'Ich habe keine Betreuungsverfügung' });
      text('preferredGuardian', 'Text14', 'Gewünschte Betreuungsperson und Kontaktdaten');
      const advice = value('medicalAdvice');
      check('Ich wurde bei der Erstellung meiner', advice === 'Ja');
      // A missing consultation does not imply an explicit waiver of consultation.
      check('Die Tragweite der Entscheidungen in', false);
      if (advice === 'Nein') extra('Ärztlich beraten und aufgeklärt', 'Nein');
      text('doctorName', ['Text20', 'Text21']);
      text('supportPerson', ['Text82', 'Text83', 'Text84']);
      put('Text85', location(), 'Ort und Datum');
      extra('Eingetragener Name der erstellenden Person (Unterschrift ergänzen)', value('signatureName'));
      extra('Eingetragener Name der Zeugin / des Zeugen (Unterschrift ergänzen)', value('witnessName'));
      text('copyLocations', ['Text7', 'Text9', 'Text11']);
      text('renewalConfirmations', ['Text13', '14', '15', '19', '20', '21']);
    }

    for (const [key, entry] of Object.entries(entries)) {
      if (consumed.has(key)) continue;
      const raw = entry && typeof entry === 'object' && 'value' in entry ? entry.value : entry;
      if (raw) extra(label(key), raw === true ? 'Ja' : raw);
    }
    if (supplements.length) {
      let page;
      let y = 0;
      let number = 0;
      const lineHeight = font.heightAtSize(10) * 1.2;
      const newPage = () => {
        page = pdf.addPage([595.28, 841.89]);
        number += 1;
        page.drawText(`Ergänzungsblatt - ${titles[docKey]}`, { x: 48, y: 789, size: 16, font });
        page.drawText('Angaben aus dem Website-Formular', { x: 48, y: 767, size: 10, font });
        page.drawLine({ start: { x: 48, y: 753 }, end: { x: 547, y: 753 }, thickness: 0.5 });
        page.drawLine({ start: { x: 48, y: 49 }, end: { x: 267, y: 49 }, thickness: 0.5 });
        page.drawLine({ start: { x: 325, y: 49 }, end: { x: 547, y: 49 }, thickness: 0.5 });
        page.drawText('Ort, Datum', { x: 48, y: 34, size: 9, font });
        page.drawText('Unterschrift', { x: 325, y: 34, size: 9, font });
        page.drawText(`Ergänzungsblatt ${number}`, { x: 48, y: 14, size: 8, font });
        y = 726;
      };
      newPage();
      let block = 0;
      for (const item of supplements) {
        const headingLines = wrap(item.heading, 493, font, 10);
        const lines = wrap(item.text, 487, font, 10);
        while (lines.length) {
          if (y < 140 + headingLines.length * 14) newPage();
          for (const line of headingLines) {
            page.drawText(line, { x: 48, y, size: 10, font, color: rgb(0.15, 0.3, 0.27) });
            y -= 14;
          }
          const count = Math.min(lines.length, Math.floor((y - 98) / lineHeight));
          const chunk = lines.splice(0, count);
          const height = chunk.length * lineHeight + 8;
          const field = form.createTextField(`website.supplement.${++block}`);
          field.enableMultiline();
          field.setText(chunk.join('\n'));
          field.addToPage(page, { x: 48, y: y - height, width: 499, height, font, borderWidth: 0 });
          field.setFontSize(10);
          y -= height + 20;
          if (lines.length) newPage();
        }
      }
    }
    form.updateFieldAppearances(font);
    return pdf.save();
  }

  function valueName(prefix) {
    return { person: 'erstellende Person', preferred: 'gewünschte Betreuungsperson', alternate: 'Ersatzperson', excluded: 'ausgeschlossene Person' }[prefix];
  }

  root.VorsorgePdf = { fill };
})(typeof window !== 'undefined' ? window : globalThis);
