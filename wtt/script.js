"use strict";

if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js";
}

const planDefaults = {
    "PPSP-NR": {
        nsua: 13,
        ax12: 15.74683,
        fcb: 0.9818,
        fatcor: 1.0037,
        taxaJurosReal: 4.37,
        tabua: "Experiência Petros 2025 / AT-2000 suavizada",
        indexador: "IPCA"
    }
};

let extratoContribTotal = null;
let contrachequeResumo = "";
let extratoResumo = "";
let concessaoResumo = "";
let irResumo = "";

function parseBRFloat(str) {
    if (str === undefined || str === null) return NaN;
    str = String(str).trim();
    if (!str) return NaN;
    str = str.replace(/[^\d,.\-]/g, "");
    str = str.replace(/\./g, "");
    str = str.replace(",", ".");
    const val = parseFloat(str);
    return isNaN(val) ? NaN : val;
}

function formatBRL(value) {
    if (value === null || value === undefined || isNaN(value)) return "–";
    try {
        return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    } catch {
        return value.toFixed(2);
    }
}

function formatNumber(value, decimals) {
    if (value === null || value === undefined || isNaN(value)) return "–";
    const d = typeof decimals === "number" ? decimals : 5;
    return value.toLocaleString("pt-BR", {
        minimumFractionDigits: d,
        maximumFractionDigits: d
    });
}

function formatDateBR(isoDate) {
    if (!isoDate) return "N/A";
    const parts = isoDate.split("-");
    if (parts.length !== 3) return isoDate;
    return parts[2] + "/" + parts[1] + "/" + parts[0];
}

function extractCurrencyInLine(line) {
    if (!line) return null;
    const matches = line.match(/(\d{1,3}(?:\.\d{3})*,\d{2})/g);
    if (!matches || matches.length === 0) return null;
    const last = matches[matches.length - 1];
    return parseBRFloat(last);
}

// Reconstrói linhas por coordenada Y
function extractTextFromPDF(file) {
    return new Promise((resolve, reject) => {
        if (!window.pdfjsLib) {
            reject(new Error("PDF.js não carregado."));
            return;
        }
        const reader = new FileReader();
        reader.onload = function(e) {
            const typedArray = new Uint8Array(e.target.result);
            pdfjsLib.getDocument({ data: typedArray }).promise.then(doc => {
                const numPages = doc.numPages;
                const textPromises = [];
                for (let pageNum = 1; pageNum <= numPages; pageNum++) {
                    textPromises.push(
                        doc.getPage(pageNum).then(page =>
                            page.getTextContent().then(content => {
                                const linesMap = {};
                                content.items.forEach(item => {
                                    const y = Math.round(item.transform[5]);
                                    if (!linesMap[y]) linesMap[y] = [];
                                    linesMap[y].push(item.str);
                                });
                                const ys = Object.keys(linesMap).map(Number).sort((a, b) => b - a);
                                const pageLines = ys.map(y => linesMap[y].join(" ")).join("\n");
                                return pageLines;
                            })
                        )
                    );
                }
                Promise.all(textPromises).then(pageTexts => {
                    const fullText = pageTexts.join("\n");
                    const compact = fullText.replace(/\s+/g, "");
                    if (!compact || compact.length < 20) {
                        resolve("");
                    } else {
                        resolve(fullText);
                    }
                }).catch(reject);
            }).catch(reject);
        };
        reader.onerror = err => reject(err);
        reader.readAsArrayBuffer(file);
    });
}

async function handleContrachequePDF(file) {
    const statusEl = document.getElementById("statusContracheque");
    statusEl.classList.remove("error");
    statusEl.textContent = "Lendo contracheque...";

    try {
        const text = await extractTextFromPDF(file);
        if (!text) {
            statusEl.classList.add("error");
            statusEl.textContent = "Não foi possível extrair texto do contracheque. Provavelmente é PDF imagem (necessita OCR).";
            contrachequeResumo = "Contracheque: PDF sem texto (imagem – necessário OCR).";
            return;
        }

        const nomeInput = document.getElementById("nome");
        let nomeLinha = null;

        let nomeRegex = /Nome\s*[:\-]?\s*([A-ZÁÂÃÉÊÍÓÔÕÚÇ0-9\s\.]+)\s+Matr[íi]cula/i;
        let nMatch = text.match(nomeRegex);
        if (!nMatch) {
            nomeRegex = /Nome\s*[:\-]?\s*[\r\n]+([A-ZÁÂÃÉÊÍÓÔÕÚÇ0-9\s\.]+)\s+Matr[íi]cula/i;
            nMatch = text.match(nomeRegex);
        }
        if (nMatch && nMatch[1]) {
            nomeLinha = nMatch[1].trim().replace(/\s{2,}.+$/, "").trim();
        }

        let beneficioBruto = null;
        const beneficioMatch = text.match(/TOTAL\s+DOS\s+PROVENTOS\s+PETROS[^\d]{0,40}(\d{1,3}(?:\.\d{3})*,\d{2})/i);
        if (beneficioMatch && beneficioMatch[1]) {
            beneficioBruto = parseBRFloat(beneficioMatch[1]);
        }

        let liquidoPetros = null;
        const liquidoMatch = text.match(/L[ÍI]QUIDO\s+PETROS[^\d]{0,40}(\d{1,3}(?:\.\d{3})*,\d{2})/i);
        if (liquidoMatch && liquidoMatch[1]) {
            liquidoPetros = parseBRFloat(liquidoMatch[1]);
        }

        const lines = text.split(/\r?\n/);
        let totalContrib = 0;
        let contribAlguma = false;

        for (let rawLine of lines) {
            const line = rawLine.trim();
            if (!line) continue;
            const upper = line.toUpperCase();

            if ((upper.includes("CONTRIBUIÇÃO PETROS") ||
                 upper.includes("CONTRIB. EXTRAORD") ||
                 upper.includes("EXTRAORDINARIA PPSP") ||
                 upper.includes("CONTRIBUIÇÃO PETROS REF.") ||
                 upper.includes("CONTRIBUIÇÃO PETROS REF") ||
                 upper.includes("PARCELAMENTO DEBITO") ||
                 upper.includes("PARC. DEBITO") ||
                 upper.includes("PED PPSP") ||
                 upper.includes("PPSP 2015") ||
                 upper.includes("PPSP 2018") ||
                 upper.includes("PPSP NR 2022") ||
                 upper.includes("PECULIO") ||
                 upper.includes("PECÚLIO")) &&
                !upper.includes("TOTAL")) {

                const v = extractCurrencyInLine(line);
                if (v !== null) {
                    totalContrib += v;
                    contribAlguma = true;
                }
            }

            if ((upper.includes("TOTAL DOS DESCONTOS PETROS") || upper.includes("TOTAL DESCONTOS PETROS")) && !contribAlguma) {
                const v = extractCurrencyInLine(line);
                if (v !== null) {
                    totalContrib += v;
                    contribAlguma = true;
                }
            }
        }

        if (nomeLinha) {
            nomeInput.value = nomeLinha;
        }

        const beneficioBrutoInput = document.getElementById("beneficioBruto");
        const totalContribInput = document.getElementById("totalContribuicoes");

        let msg = "Contracheque lido com sucesso.";

        if (nomeLinha) {
            msg += "\n• Nome identificado (contracheque): " + nomeLinha + ".";
        } else {
            msg += "\n• Não foi possível identificar o nome no contracheque.";
        }

        if (beneficioBruto !== null && !isNaN(beneficioBruto)) {
            beneficioBrutoInput.value = formatBRL(beneficioBruto).replace("R$", "").trim();
            msg += "\n• Benefício bruto em “TOTAL DOS PROVENTOS PETROS”: " + formatBRL(beneficioBruto) + ".";
        } else {
            msg += "\n• Não foi possível identificar o benefício bruto em “TOTAL DOS PROVENTOS PETROS”.";
        }

        if (contribAlguma) {
            totalContribInput.value = formatBRL(totalContrib).replace("R$", "").trim();
            msg += "\n• Contribuições PETROS somadas (normal + extraordinárias + PED + pecúlio): " + formatBRL(totalContrib) + ".";
        } else {
            msg += "\n• Não foi possível identificar automaticamente as contribuições PETROS.";
        }

        if (liquidoPetros !== null && !isNaN(liquidoPetros)) {
            msg += "\n• Benefício líquido PETROS (para conferência): " + formatBRL(liquidoPetros) + ".";
        }

        statusEl.textContent = msg;
        contrachequeResumo = msg;
    } catch (err) {
        console.error(err);
        statusEl.classList.add("error");
        statusEl.textContent = "Erro ao ler contracheque: " +
            (err && err.message ? err.message : "erro desconhecido.");
        contrachequeResumo = "Erro na leitura do contracheque.";
    }
}

async function handleExtratoPDF(file) {
    const statusEl = document.getElementById("statusExtrato");
    statusEl.classList.remove("error");
    statusEl.textContent = "Lendo extrato de contribuições...";

    try {
        const text = await extractTextFromPDF(file);
        if (!text) {
            statusEl.classList.add("error");
            statusEl.textContent = "Não foi possível extrair texto do extrato. Provavelmente é PDF imagem (necessita OCR).";
            extratoResumo = "Extrato: PDF sem texto (imagem – necessário OCR).";
            return;
        }

        const temHistoricoMoedas = /HIST[ÓO]RICO\s+DE\s+ALTERA[ÇC][ÕO]ES\s+DE\s+MOEDAS/i.test(text);

        let sum = 0;
        let encontrou = false;
        let msg = "";

        if (temHistoricoMoedas) {
            const reRS = /R\$\s*(\d{1,3}(?:\.\d{3})*,\d{2})/g;
            let m;
            while ((m = reRS.exec(text)) !== null) {
                const v = parseBRFloat(m[1]);
                if (!isNaN(v)) {
                    sum += v;
                    encontrou = true;
                }
            }

            if (encontrou) {
                extratoContribTotal = sum;
                msg = "Extrato lido com sucesso.\n• Detectado “Histórico de alterações de moedas”.\n• Somados apenas valores explicitamente em R$ (período pós-Real).\n• Soma total em R$: " + formatBRL(sum) + ".\n\nATENÇÃO: valores em Cr$, Cz$, NCz$, CR$ ou URV não foram convertidos automaticamente; converta-os à parte e informe manualmente se necessário.";
            } else {
                extratoContribTotal = null;
                msg = "Extrato lido com sucesso.\n• Detectado “Histórico de alterações de moedas” (Cr$, Cz$, NCz$, CR$, URV, R$).\n• Nenhum valor em R$ foi identificado para soma segura.\n\nPor segurança, a calculadora não fará soma automática deste extrato.";
            }
        } else {
            const matches = text.match(/(\d{1,3}(?:\.\d{3})*,\d{2})/g);
            if (!matches || matches.length === 0) {
                statusEl.textContent = "Texto lido, mas não foram encontrados valores monetários com padrão 0.000,00.";
                extratoResumo = "Extrato: texto lido, sem valores monetários detectados.";
                return;
            }
            for (const val of matches) {
                const v = parseBRFloat(val);
                if (!isNaN(v)) {
                    sum += v;
                    encontrou = true;
                }
            }
            if (encontrou) {
                extratoContribTotal = sum;
                msg = "Extrato lido com sucesso.\n• Valores monetários identificados e somados (presumidos em R$).\n• Soma total das contribuições: " + formatBRL(sum) + ".";
            } else {
                msg = "Extrato lido, mas não foi possível interpretar os valores monetários.";
            }
        }

        if (encontrou && extratoContribTotal !== null) {
            const totalContribInput = document.getElementById("totalContribuicoes");
            if (!totalContribInput.value) {
                totalContribInput.value = formatBRL(extratoContribTotal).replace("R$", "").trim();
            }
        }

        statusEl.textContent = msg;
        extratoResumo = msg;
    } catch (err) {
        console.error(err);
        statusEl.classList.add("error");
        statusEl.textContent = "Erro ao ler extrato de contribuições: " +
            (err && err.message ? err.message : "erro desconhecido.");
        extratoResumo = "Erro na leitura do extrato.";
    }
}

async function handleConcessaoPDF(file) {
    const statusEl = document.getElementById("statusConcessao");
    statusEl.classList.remove("error");
    statusEl.textContent = "Lendo cálculo de concessão / estudo atuarial...";

    try {
        const text = await extractTextFromPDF(file);
        if (!text) {
            statusEl.classList.add("error");
            statusEl.textContent = "Não foi possível extrair texto do cálculo de concessão. Provavelmente é PDF imagem (necessita OCR).";
            concessaoResumo = "Concessão: PDF sem texto (imagem – necessário OCR).";
            return;
        }

        let axMatch = text.match(/[aä]x\(12\)\s*([\d.,]+)/i);
        if (!axMatch) {
            axMatch = text.match(/[aä]x\s*\(12\)\s*([\d.,]+)/i);
        }
        let fcbMatch = text.match(/FCB\s*([\d.,]+)/i);
        let fatMatch = text.match(/FAT(?:OR)?\s*(?:INPC)?[^\d]{0,20}([\d]{1,3}(?:\.\d{3})*,\d{2})/i);

        const axInput = document.getElementById("ax12");
        const fcbInput = document.getElementById("fcb");
        const fatcorInput = document.getElementById("fatcor");

        let msg = "Cálculo de concessão lido com sucesso.";
        let algum = false;

        if (axMatch && axMatch[1]) {
            axInput.value = axMatch[1].trim();
            msg += "\n• äₓ(12) identificado: " + axMatch[1].trim() + ".";
            algum = true;
        }
        if (fcbMatch && fcbMatch[1]) {
            fcbInput.value = fcbMatch[1].trim();
            msg += "\n• FCB identificado: " + fcbMatch[1].trim() + ".";
            algum = true;
        }
        if (fatMatch && fatMatch[1]) {
            fatcorInput.value = fatMatch[1].trim();
            msg += "\n• FATCOR (Fator INPC) identificado: " + fatMatch[1].trim() + ".";
            algum = true;
        }

        if (!algum) {
            msg += "\n• Não foi possível localizar äₓ(12), FCB ou FATCOR automaticamente.";
        }

        statusEl.textContent = msg;
        concessaoResumo = msg;
    } catch (err) {
        console.error(err);
        statusEl.classList.add("error");
        statusEl.textContent = "Erro ao ler cálculo de concessão: " +
            (err && err.message ? err.message : "erro desconhecido.");
        concessaoResumo = "Erro na leitura do cálculo de concessão.";
    }
}

async function handleIRPDF(file) {
    const statusEl = document.getElementById("statusIR");
    statusEl.classList.remove("error");
    statusEl.textContent = "Lendo declaração de IR...";

    try {
        const text = await extractTextFromPDF(file);
        if (!text) {
            statusEl.classList.add("error");
            statusEl.textContent = "Não foi possível extrair texto da declaração de IR. Provavelmente é PDF imagem (necessita OCR).";
            irResumo = "IR: PDF sem texto (imagem – necessário OCR).";
            return;
        }

        const nomeInput = document.getElementById("nome");
        let nome = null;

        let nomeMatch = text.match(/NOME:\s*([A-ZÁÂÃÉÊÍÓÔÕÚÇ0-9\s\.]+)/);
        if (nomeMatch && nomeMatch[1]) {
            nome = nomeMatch[1].trim();
        } else {
            nomeMatch = text.match(/Nome:\s*([A-ZÁÂÃÉÊÍÓÔÕÚÇ0-9\s\.]+)/i);
            if (nomeMatch && nomeMatch[1]) {
                nome = nomeMatch[1].trim();
            }
        }

        let msg = "Declaração de IR lida com sucesso.";
        if (nome && !nomeInput.value) {
            nomeInput.value = nome;
            msg += "\n• Nome identificado (IR): " + nome + " (usado por ausência de nome no contracheque).";
        } else if (nome) {
            msg += "\n• Nome identificado (IR): " + nome + " (não sobrescreveu o nome do contracheque).";
        } else {
            msg += "\n• Não foi possível identificar o nome automaticamente (campo NOME/Nome).";
        }

        statusEl.textContent = msg;
        irResumo = msg;
    } catch (err) {
        console.error(err);
        statusEl.classList.add("error");
        statusEl.textContent = "Erro ao ler declaração de IR: " +
            (err && err.message ? err.message : "erro desconhecido.");
        irResumo = "Erro na leitura da declaração de IR.";
    }
}

function calcularVAEBA() {
    const plano = document.getElementById("plano").value || "N/A";

    const beneficioBrutoStr = document.getElementById("beneficioBruto").value;
    const totalContribStr = document.getElementById("totalContribuicoes").value;

    const beneficioBruto = parseBRFloat(beneficioBrutoStr);
    const totalContrib = parseBRFloat(totalContribStr);

    if (isNaN(beneficioBruto)) {
        alert("Informe um valor numérico válido para o benefício Petros bruto.");
        return;
    }

    if (isNaN(totalContrib)) {
        alert("Informe um valor numérico válido para o total de contribuições.");
        return;
    }

    const SUP_bruta = beneficioBruto;
    const SUP_liquida = beneficioBruto - totalContrib;

    const nsuaStr = document.getElementById("nsua").value;
    const ax12Str = document.getElementById("ax12").value;
    const fcbStr = document.getElementById("fcb").value;
    const fatcorStr = document.getElementById("fatcor").value;

    const nsua = parseBRFloat(nsuaStr);
    const ax12 = parseBRFloat(ax12Str);
    const fcbVal = parseBRFloat(fcbStr);
    const fatcorVal = parseBRFloat(fatcorStr);

    if (isNaN(nsua) || nsua <= 0) {
        alert("Informe um NSUA válido.");
        return;
    }
    if (isNaN(ax12) || ax12 <= 0) {
        alert("Informe um valor válido para äₓ(12).");
        return;
    }

    const missingFcb = !fcbStr || isNaN(fcbVal);
    const missingFatcor = !fatcorStr || isNaN(fatcorVal);

    const fcbForCalc = missingFcb ? 1 : fcbVal;
    const fatcorForCalc = missingFatcor ? 1 : fatcorVal;

    const parcial = missingFcb || missingFatcor;

    const K = nsua * ax12 * fcbForCalc * fatcorForCalc;
    const VAEBA_bruta = K * SUP_bruta;
    const VAEBA_liquida = K * SUP_liquida;

    document.getElementById("resultadoK").textContent = formatNumber(K, 5);
    document.getElementById("resultadoLiquida").textContent = formatBRL(VAEBA_liquida);
    document.getElementById("resultadoBruta").textContent = formatBRL(VAEBA_bruta);

    const statusResultado = document.getElementById("statusResultado");
    const notaResultado = document.getElementById("notaResultado");

    if (parcial) {
        const faltando = [];
        if (missingFcb) faltando.push("FCB");
        if (missingFatcor) faltando.push("FATCOR");
        statusResultado.textContent = "Resultado parcial (faltando " + faltando.join(" e ") + ")";
        notaResultado.innerHTML = "Foi adotado o valor 1,00 para o(s) fator(es) faltante(s) (" +
            faltando.join(" e ") +
            ") apenas para pré-visualização.<br><strong>Preencha FCB e FATCOR para o resultado final.</strong>";
    } else {
        statusResultado.textContent = "Resultado completo (plano " + plano + ")";
        notaResultado.textContent = "Cálculo realizado com todos os fatores atuariais preenchidos.";
    }

    gerarAuditoria(K, VAEBA_liquida, VAEBA_bruta, parcial, missingFcb, missingFatcor);
}

function gerarAuditoria(K, vaebaLiquida, vaebaBruta, parcial, missingFcb, missingFatcor) {
    const plano = document.getElementById("plano").value || "N/A";
    const nome = document.getElementById("nome").value || "N/A";
    const dataBaseISO = document.getElementById("dataBase").value;
    const dataBase = formatDateBR(dataBaseISO);
    const idade = document.getElementById("idade").value || "N/A";

    let sexo = "N/A";
    document.querySelectorAll('input[name="sexo"]').forEach(r => {
        if (r.checked) sexo = r.value;
    });

    const beneficioBrutoStr = document.getElementById("beneficioBruto").value || "N/A";
    const totalContribStr = document.getElementById("totalContribuicoes").value || "N/A";

    const nsuaStr = document.getElementById("nsua").value || "N/A";
    const ax12Str = document.getElementById("ax12").value || "N/A";
    const fcbStr = document.getElementById("fcb").value || "N/A";
    const fatcorStr = document.getElementById("fatcor").value || "N/A";
    const taxaJurosReal = document.getElementById("taxaJurosReal").value || "N/A";
    const tabua = document.getElementById("tabua").value || "N/A";
    const indexador = document.getElementById("indexador").value || "N/A";

    const supBr = parseBRFloat(beneficioBrutoStr);
    const totCon = parseBRFloat(totalContribStr);
    const supLiq = (isNaN(supBr) || isNaN(totCon)) ? null : supBr - totCon;

    let obsParcial = "Nenhuma.";
    if (parcial) {
        const faltando = [];
        if (missingFcb) faltando.push("FCB");
        if (missingFatcor) faltando.push("FATCOR");
        obsParcial = "Resultado parcial. Fatores assumidos como 1,00: " + faltando.join(" e ") + ".";
    }

    let texto = "";
    texto += "=== DADOS GERAIS ===\n";
    texto += "Plano: " + plano + "\n";
    texto += "Nome do participante: " + nome + "\n";
    texto += "Data-base do cálculo: " + dataBase + "\n";
    texto += "Idade x: " + idade + " anos\n";
    texto += "Sexo: " + sexo + "\n\n";

    texto += "=== BENEFÍCIO E CONTRIBUIÇÕES (MÊS BASE) ===\n";
    texto += "Benefício Petros bruto: " + beneficioBrutoStr + "\n";
    texto += "Total de contribuições: " + totalContribStr + "\n";
    texto += "SUP líquida (bruto – contribuições): " +
        (supLiq !== null ? formatBRL(supLiq) : "N/A") + "\n\n";

    texto += "=== PARÂMETROS ATUARIAIS USADOS ===\n";
    texto += "NSUA: " + nsuaStr + "\n";
    texto += "äₓ(12): " + ax12Str + "\n";
    texto += "FCB: " + fcbStr + "\n";
    texto += "FATCOR: " + fatcorStr + "\n";
    texto += "Taxa de juros real: " + taxaJurosReal + "\n";
    texto += "Tábua biométrica: " + tabua + "\n";
    texto += "Indexador econômico: " + indexador + "\n\n";

    texto += "=== FATOR GLOBAL K ===\n";
    texto += "K (numérico): " + formatNumber(K, 5) + "\n\n";

    texto += "=== RESULTADOS DA VAEBA ===\n";
    texto += "VAEBA líquida: " + formatBRL(vaebaLiquida) + "\n";
    texto += "VAEBA bruta: " + formatBRL(vaebaBruta) + "\n";
    texto += "Observação sobre completude: " + obsParcial + "\n\n";

    texto += "=== INFORMAÇÕES EXTRAÍDAS DOS PDFs ===\n";
    texto += (contrachequeResumo || "Contracheque: não enviado ou não processado.") + "\n\n";
    texto += (extratoResumo || "Extrato de contribuições: não enviado ou não processado.") + "\n\n";
    texto += (concessaoResumo || "Cálculo de concessão: não enviado ou não processado.") + "\n\n";
    texto += (irResumo || "Declaração de IR: não enviada ou não processada.") + "\n";

    if (extratoContribTotal !== null) {
        texto += "\nSoma total de contribuições em R$ detectada no extrato: " +
            formatBRL(extratoContribTotal) + ".\n";
    }

    document.getElementById("auditoria").value = texto;
}

function limparTudo() {
    document.getElementById("calcForm").reset();

    extratoContribTotal = null;
    contrachequeResumo = "";
    extratoResumo = "";
    concessaoResumo = "";
    irResumo = "";

    document.getElementById("statusContracheque").classList.remove("error");
    document.getElementById("statusExtrato").classList.remove("error");
    document.getElementById("statusConcessao").classList.remove("error");
    document.getElementById("statusIR").classList.remove("error");

    document.getElementById("statusContracheque").textContent =
        "Extrairá nome (bloco “Nome”) + benefício bruto (“TOTAL DOS PROVENTOS PETROS”) + contribuições PETROS.";
    document.getElementById("statusExtrato").textContent =
        "Se houver apenas R$, somará contribuições. Se houver “Histórico de alterações de moedas”, a soma automática será limitada.";
    document.getElementById("statusConcessao").textContent =
        "Tentará extrair äₓ(12), FCB e FATCOR (quando constarem em texto).";
    document.getElementById("statusIR").textContent =
        "Usada como fonte secundária de nome (apenas se o contracheque não trouxer).";

    document.getElementById("resultadoK").textContent = "–";
    document.getElementById("resultadoLiquida").textContent = "–";
    document.getElementById("resultadoBruta").textContent = "–";
    document.getElementById("statusResultado").textContent = "Aguardando cálculo";
    document.getElementById("notaResultado").textContent =
        "Informe os dados e clique em Calcular VAEBA.";
    document.getElementById("auditoria").value = "";

    const advanced = document.getElementById("advancedContent");
    const icon = document.getElementById("toggleIcon");
    advanced.classList.remove("visible");
    icon.textContent = "+";

    const planoSelect = document.getElementById("plano");
    const plano = planoSelect.value;
    if (plano && planDefaults[plano]) aplicarDefaultsPlano(plano);
}

function aplicarDefaultsPlano(plano) {
    const defs = planDefaults[plano];
    if (!defs) return;
    document.getElementById("nsua").value = defs.nsua;
    document.getElementById("ax12").value = defs.ax12.toString().replace(".", ",");
    document.getElementById("fcb").value = defs.fcb.toString().replace(".", ",");
    document.getElementById("fatcor").value = defs.fatcor.toString().replace(".", ",");
    document.getElementById("taxaJurosReal").value = defs.taxaJurosReal.toString().replace(".", ",");
    document.getElementById("tabua").value = defs.tabua;
    document.getElementById("indexador").value = defs.indexador;
}

document.addEventListener("DOMContentLoaded", () => {
    const planoSelect = document.getElementById("plano");
    planoSelect.addEventListener("change", () => {
        const val = planoSelect.value;
        if (val && planDefaults[val]) aplicarDefaultsPlano(val);
    });

    const toggleBtn = document.getElementById("toggleAdvanced");
    const advancedContent = document.getElementById("advancedContent");
    const toggleIcon = document.getElementById("toggleIcon");

    toggleBtn.addEventListener("click", () => {
        const visible = advancedContent.classList.toggle("visible");
        toggleIcon.textContent = visible ? "−" : "+";
    });

    document.getElementById("btnCalcular").addEventListener("click", calcularVAEBA);
    document.getElementById("btnLimpar").addEventListener("click", limparTudo);

    document.getElementById("contrachequePdf").addEventListener("change", e => {
        const file = e.target.files && e.target.files[0];
        if (file) handleContrachequePDF(file);
    });

    document.getElementById("extratoPdf").addEventListener("change", e => {
        const file = e.target.files && e.target.files[0];
        if (file) handleExtratoPDF(file);
    });

    document.getElementById("concessaoPdf").addEventListener("change", e => {
        const file = e.target.files && e.target.files[0];
        if (file) handleConcessaoPDF(file);
    });

    document.getElementById("irPdf").addEventListener("change", e => {
        const file = e.target.files && e.target.files[0];
        if (file) handleIRPDF(file);
    });

    planoSelect.value = "PPSP-NR";
    aplicarDefaultsPlano("PPSP-NR");
});