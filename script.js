/* --------------------------
   Funções auxiliares
----------------------------- */
function brToNumber(v) {
    if (!v) return 0;
    return Number(v.replace(/\./g, "").replace(",", "."));
}
function formatBR(n) {
    return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/* --------------------------
   Parâmetros padrão
----------------------------- */
function setDefaults() {
    document.getElementById("nsua").value = 13;
    document.getElementById("ax12").value = "15,74683";
    document.getElementById("fcb").value = "0,9818";
    document.getElementById("fatcor").value = "1,0037";
    document.getElementById("taxaReal").value = "4,37";
    document.getElementById("tabua").value =
        "Experiência Petros 2025 (geral) / AT-83 inválidos";
    document.getElementById("indexador").value = "IPCA (IBGE)";
}
setDefaults();

/* --------------------------
   Toggle avançado
----------------------------- */
document.getElementById("toggleAdv").onclick = () => {
    const s = document.getElementById("advSection");
    s.style.display = s.style.display === "block" ? "none" : "block";
};

/* --------------------------
   Leitura PDF
----------------------------- */
async function readPdf(file) {
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;

    let text = "";
    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const cont = await page.getTextContent();
        if (!cont.items || cont.items.length === 0) continue;
        text += cont.items.map(it => it.str).join(" ") + "\n";
    }
    return text.trim();
}

/* --------------------------
   Contracheque
----------------------------- */
document.getElementById("contracheque").addEventListener("change", async e => {
    const file = e.target.files[0];
    if (!file) return;

    const t = await readPdf(file);
    if (!t) {
        document.getElementById("statusContra").textContent =
            "Este PDF parece ser apenas imagem.";
        return;
    }

    // Nome
    let nome = "";
    const mNome = t.match(/Nome\s+(.+?)\s+Matr/i);
    if (mNome) {
        nome = mNome[1].trim().toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
        document.getElementById("nome").value = nome;
        document.getElementById("statusContra").textContent = "Nome identificado.";
    }

    // Benefício bruto
    const linhas = t.split("\n");
    let found = false;
    for (let l of linhas) {
        if (/TOTAL/i.test(l) && /PROVENTOS/i.test(l) && /PETROS/i.test(l)) {
            const vals = l.match(/\d{1,3}(?:\.\d{3})*,\d{2}/g);
            if (vals && vals.length > 0) {
                const val = vals[vals.length - 1];
                document.getElementById("supBruta").value = val;
                document.getElementById("statusSup").textContent =
                    "Benefício bruto identificado.";
                found = true;
            }
        }
    }
    if (!found)
        document.getElementById("statusSup").textContent =
            "Não foi possível identificar o benefício bruto.";
});

/* --------------------------
   Extrato contribuições
----------------------------- */
document.getElementById("extrato").addEventListener("change", async e => {
    const file = e.target.files[0];
    if (!file) return;

    const t = await readPdf(file);
    if (!t) {
        document.getElementById("statusExtrato").textContent =
            "PDF sem texto (imagem).";
        return;
    }

    let conv = { "R$": 1, "URV": 1, "CR$": 1, "Cr$": 1, "NCz$": 1, "Cz$": 1 };

    const linhas = t.split("\n");
    let soma = 0;
    let count = 0;
    const moedas = ["R$", "URV", "CR$", "Cr$", "NCz$", "Cz$"];

    for (let l of linhas) {
        let moeda = moedas.find(m => l.includes(m));
        if (!moeda) continue;

        const vals = l.match(/\d{1,3}(?:\.\d{3})*,\d{2}/g);
        if (!vals) continue;

        for (let v of vals) {
            count++;
            const num = brToNumber(v);
            soma += num * (conv[moeda] || 1);
        }
    }

    document.getElementById("totalContrib").value =
        soma.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    document.getElementById("statusExtrato").textContent =
        `Identificados ${count} valores; soma aplicada.`;
});

/* --------------------------
   Cálculo atuarial
----------------------------- */
document.getElementById("calculo").addEventListener("change", async e => {
    const file = e.target.files[0];
    if (!file) return;

    const t = await readPdf(file);
    if (!t) {
        document.getElementById("statusCalc").textContent = "PDF sem texto.";
        return;
    }

    let achou = [];

    const ax = t.match(/a[\¨\^]?x?\(12\)\s*([\d\.\,]+)/i);
    if (ax) {
        document.getElementById("ax12").value = ax[1];
        achou.push("äₓ(12)");
    }

    const fcb = t.match(/FCB[^0-9]*([\d\.\,]+)/i);
    if (fcb) {
        document.getElementById("fcb").value = fcb[1];
        achou.push("FCB");
    }

    const fat = t.match(/FATCOR[^0-9]*([\d\.\,]+)/i);
    if (fat) {
        document.getElementById("fatcor").value = fat[1];
        achou.push("FATCOR");
    }

    document.getElementById("statusCalc").textContent =
        achou.length ? achou.join(", ") + " identificados."
            : "Nenhum parâmetro identificado.";
});

/* --------------------------
   Declaração IR
----------------------------- */
document.getElementById("ir").addEventListener("change", async e => {
    const file = e.target.files[0];
    if (!file) return;

    const t = await readPdf(file);
    if (!t) {
        document.getElementById("statusIr").textContent = "PDF sem texto.";
        return;
    }

    const m = t.match(/CPF[:\s]*\d{3}\.\d{3}\.\d{3}-\d{2}\s+Nome[:\s]+([A-Z\s]+)/);
    if (m) {
        const nome = m[1].trim().toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
        if (!document.getElementById("nome").value)
            document.getElementById("nome").value = nome;

        document.getElementById("statusIr").textContent = "Nome encontrado.";
    } else {
        document.getElementById("statusIr").textContent = "Nome não encontrado.";
    }
});

/* --------------------------
   Cálculo VAEBA
----------------------------- */
document.getElementById("calcBtn").onclick = () => {

    const supBruta = brToNumber(document.getElementById("supBruta").value);
    const tot = brToNumber(document.getElementById("totalContrib").value);

    const nsua = Number(document.getElementById("nsua").value);
    const ax = brToNumber(document.getElementById("ax12").value);

    let fcb = brToNumber(document.getElementById("fcb").value);
    let fat = brToNumber(document.getElementById("fatcor").value);

    let parcial = false;

    if (!fcb) { fcb = 1; parcial = true; }
    if (!fat) { fat = 1; parcial = true; }

    const supLiq = supBruta - tot;
    const K = nsua * ax * fcb * fat;

    const vaebaLiq = nsua * supLiq * ax * fcb * fat;
    const vaebaBruta = nsua * supBruta * ax * fcb * fat;

    document.getElementById("resSupLiq").textContent = formatBR(supLiq);
    document.getElementById("resK").textContent =
        K.toLocaleString("pt-BR", { minimumFractionDigits: 4 });
    document.getElementById("resVaebaLiq").textContent = formatBR(vaebaLiq);
    document.getElementById("resVaebaBruta").textContent = formatBR(vaebaBruta);

    document.getElementById("partialInfo").textContent =
        parcial ? "RESULTADO PARCIAL: FCB/FATCOR assumidos como 1,00." : "";

    const aud =
        `Plano: ${document.getElementById("plano").value}
Nome: ${document.getElementById("nome").value}
Data-base: ${document.getElementById("dataBase").value}
Idade x: ${document.getElementById("idade").value}   Sexo: ${document.getElementById("sexo").value}
Benefício bruto: ${document.getElementById("supBruta").value}
Total contribuições: ${document.getElementById("totalContrib").value}
SUP líquida: ${formatBR(supLiq)}
NSUA: ${nsua}
äₓ(12): ${document.getElementById("ax12").value}
FCB: ${document.getElementById("fcb").value}
FATCOR: ${document.getElementById("fatcor").value}
Taxa real: ${document.getElementById("taxaReal").value} % a.a.
Tábua: ${document.getElementById("tabua").value}
Indexador: ${document.getElementById("indexador").value}
Fórmula: VAEBA = NSUA × SUP × äₓ(12) × FCB × FATCOR
K = ${K.toLocaleString("pt-BR")}
VAEBA líquida = ${formatBR(vaebaLiq)}
VAEBA bruta = ${formatBR(vaebaBruta)}
${parcial ? "Resultado parcial: FCB/FATCOR assumidos como 1,00." : ""}`;

    document.getElementById("auditoria").value = aud;
};

/* --------------------------
   Limpar tudo
----------------------------- */
document.getElementById("clearBtn").onclick = () => {
    document.querySelectorAll("input[type=text],input[type=date],input[type=number]")
        .forEach(i => i.value = "");

    document.getElementById("sexo").value = "";
    document.getElementById("nome").value = "";

    ["statusSup", "statusContrib", "statusContra", "statusExtrato", "statusCalc", "statusIr"]
        .forEach(id => document.getElementById(id).textContent = "");

    setDefaults();

    document.getElementById("resVaebaLiq").textContent = "–";
    document.getElementById("resVaebaBruta").textContent = "–";
    document.getElementById("resK").textContent = "–";
    document.getElementById("resSupLiq").textContent = "–";
    document.getElementById("partialInfo").textContent = "";
    document.getElementById("auditoria").value = "";

    document.getElementById("contracheque").value = "";
    document.getElementById("extrato").value = "";
    document.getElementById("calculo").value = "";
    document.getElementById("ir").value = "";
};
