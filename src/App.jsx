import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  MapPin, FileText, Search, TrendingUp, Plus, X, Loader2,
  CheckCircle2, AlertTriangle, ExternalLink, Trash2, Pencil,
  Sparkles, Calendar, Coins, ChevronRight, Archive, Clock, Camera, Star
} from "lucide-react";
import { storage } from "./lib/storage";
import { callClaude } from "./lib/ai";


/* ---------------------------------------------------------
   TOKENS — "chanote ledger" theme: pale sage title-deed paper,
   deep forest ink, brass figures, red official-seal accent.
--------------------------------------------------------- */
const C = {
  paper: "#EAF0E2",
  panel: "#F6F4E8",
  panelDeep: "#EFEBDA",
  ink: "#20301F",
  inkSoft: "#4B5A45",
  line: "#C7CDB2",
  brass: "#93701F",
  seal: "#9C2B22",
  good: "#3C6E47",
  warn: "#A9791F",
  bad: "#9C2B22",
};

const FONT_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Noto+Serif+Thai:wght@500;600;700&family=Noto+Sans+Thai:wght@400;500;600;700&display=swap');
.kf-serif { font-family: 'Noto Serif Thai', serif; }
.kf-sans { font-family: 'Noto Sans Thai', sans-serif; }
.kf-texture {
  background-image: repeating-linear-gradient(115deg, rgba(32,48,31,0.035) 0px, rgba(32,48,31,0.035) 1px, transparent 1px, transparent 10px);
}
.kf-scroll::-webkit-scrollbar { width: 6px; height: 6px; }
.kf-scroll::-webkit-scrollbar-thumb { background: ${C.line}; border-radius: 4px; }
@keyframes kf-fade { from { opacity:0; transform: translateY(4px);} to {opacity:1; transform:none;} }
.kf-in { animation: kf-fade .25s ease-out; }
`;

/* ---------------------------------------------------------
   HELPERS
--------------------------------------------------------- */
function uid() { return Math.random().toString(36).slice(2, 10); }

function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

function compressImage(file, maxDim = 900, quality = 0.45) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read failed"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("decode failed"));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const scale = maxDim / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function fmtBaht(n) {
  if (n === null || n === undefined || n === "" || isNaN(n)) return "-";
  return Number(n).toLocaleString("th-TH", { maximumFractionDigits: 0 }) + " บาท";
}

function fmtDate(d) {
  if (!d) return "-";
  try {
    return new Date(d).toLocaleDateString("th-TH", { year: "numeric", month: "short", day: "numeric" });
  } catch { return d; }
}

function addMonths(date, months) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

function noticeStatus(dueDateStr, status) {
  if (!dueDateStr || status !== "active") return null;
  const due = new Date(dueDateStr);
  const today = new Date();
  const windowOpen = addMonths(due, -6);
  const windowClose = addMonths(due, -3);
  if (today < windowOpen) {
    const days = Math.ceil((windowOpen - today) / 86400000);
    return { level: "info", text: `ยังไม่ถึงช่วงแจ้ง (อีก ${days} วันจะเข้าช่วงที่ควรส่ง)` };
  }
  if (today >= windowOpen && today <= windowClose) {
    return { level: "good", text: "อยู่ในช่วงที่ควรส่งหนังสือแจ้งครบกำหนดไถ่ถอน" };
  }
  if (today > windowClose && today <= due) {
    const days = Math.ceil((due - today) / 86400000);
    return { level: "warn", text: `เลยช่วงที่เหมาะสมแล้ว ควรรีบส่งด่วน (เหลือ ${days} วันถึงกำหนด)` };
  }
  if (today > due) {
    return { level: "bad", text: "เลยวันครบกำหนดไถ่ถอนแล้ว" };
  }
  return null;
}

const CATEGORY_LABELS = [
  ["location", "ทำเลและศักยภาพพื้นที่"],
  ["price", "ราคาต่อรองเทียบราคาตลาด/ราคาประเมิน"],
  ["legal", "เอกสารสิทธิ์และสถานะทางกฎหมาย"],
  ["liquidity", "สภาพคล่องในการขายต่อ"],
  ["trend", "แนวโน้มมูลค่าในอนาคต"],
  ["risk", "ความเสี่ยงและข้อจำกัดของแปลง"],
  ["returnIfForeclosed", "ผลตอบแทนกรณีที่ดินหลุดเป็นกรรมสิทธิ์"],
];

const ANALYSIS_SCHEMA_NOTE = `ตอบกลับเป็น JSON ล้วนเท่านั้น ห้ามมีข้อความอื่นนอกเหนือจาก JSON และห้ามใช้ markdown code fence โครงสร้างต้องเป็น:
{
 "overall_score": number (0-10 ทศนิยม 1 ตำแหน่ง),
 "verdict": "น่าลงทุน" | "ควรพิจารณาเพิ่มเติม" | "ไม่แนะนำ",
 "categories": [ {"key":"location","score":number,"note":"เหตุผลสั้นไม่เกิน 12 คำ"}, {"key":"price","score":number,"note":"..."}, {"key":"legal","score":number,"note":"..."}, {"key":"liquidity","score":number,"note":"..."}, {"key":"trend","score":number,"note":"..."}, {"key":"risk","score":number,"note":"..."}, {"key":"returnIfForeclosed","score":number,"note":"..."} ],
 "market_price_estimate": {"low": number, "high": number, "unit": "บาทต่อไร่ หรือ บาทรวมทั้งแปลง ระบุให้ชัด"},
 "resale": {
   "quick_sale": {"price": number, "timeframe": "เช่น ภายใน 1 เดือน", "note": "เหตุผลสั้น"},
   "optimal_sale": {"price": number, "timeframe": "เช่น 4-6 เดือน", "note": "เหตุผลสั้น"}
 },
 "summary": "สรุปภาพรวม 1-2 ประโยค"
}`;

/* ---------------------------------------------------------
   SMALL UI PRIMITIVES
--------------------------------------------------------- */
function Seal({ children, tone = "good" }) {
  const color = tone === "good" ? C.good : tone === "warn" ? C.warn : tone === "bad" ? C.bad : C.inkSoft;
  return (
    <span
      className="kf-sans inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
      style={{ border: `1px solid ${color}`, color }}
    >
      {children}
    </span>
  );
}

function Field({ label, children }) {
  return (
    <label className="flex flex-col gap-1 text-sm kf-sans" style={{ color: C.inkSoft }}>
      <span>{label}</span>
      {children}
    </label>
  );
}

function inputStyle() {
  return {
    background: "#fff",
    border: `1px solid ${C.line}`,
    color: C.ink,
  };
}

function ScoreGauge({ score, threshold = 9.0 }) {
  const pct = Math.max(0, Math.min(10, score)) / 10 * 100;
  const zoneColor = score >= threshold ? C.good : score >= 6 ? C.warn : C.bad;
  return (
    <div className="flex items-center gap-4">
      <div className="kf-serif" style={{ fontSize: 40, color: zoneColor, lineHeight: 1 }}>
        {score.toFixed(1)}
      </div>
      <div className="flex-1">
        <div className="relative h-3 rounded-full overflow-hidden" style={{ background: C.panelDeep, border: `1px solid ${C.line}` }}>
          <div className="absolute inset-y-0 left-0" style={{ width: `${pct}%`, background: zoneColor }} />
          <div className="absolute inset-y-0" style={{ left: `${threshold * 10}%`, width: 1, background: C.ink, opacity: 0.4 }} />
        </div>
        <div className="flex justify-between kf-sans text-[10px] mt-1" style={{ color: C.inkSoft }}>
          <span>0</span><span>เกณฑ์น่าลงทุน {threshold.toFixed(1)}</span><span>10</span>
        </div>
      </div>
    </div>
  );
}

function CategoryBar({ label, score, note }) {
  const color = score >= 9 ? C.good : score >= 6 ? C.warn : C.bad;
  const pct = Math.max(0, Math.min(10, score)) / 10 * 100;
  return (
    <div className="py-1.5">
      <div className="flex justify-between kf-sans text-sm" style={{ color: C.ink }}>
        <span>{label}</span>
        <span style={{ color, fontWeight: 600 }}>{score.toFixed(1)}</span>
      </div>
      <div className="h-1.5 rounded-full mt-1 overflow-hidden" style={{ background: C.panelDeep }}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
      {note && <div className="kf-sans text-xs mt-0.5" style={{ color: C.inkSoft }}>{note}</div>}
    </div>
  );
}

/* ---------------------------------------------------------
   PORTFOLIO TAB
--------------------------------------------------------- */
const DEFAULT_COST_CALC = {
  marketValue: "", interestRate: 0.0125, prepaidMonths: 2,
  depositFeeSelfPct: 0.02, brokerFeePct: 0.03, transferFeePct: 0.02,
  stampDuty: "", incomeTax: "", contractMonths: 12,
};

const EMPTY_PLOT = {
  code: "", province: "", district: "", subdistrict: "",
  sizeRai: "", sizeNgan: "", sizeWah: "", deedType: "โฉนดที่ดิน",
  appraisedValue: "", contractAmount: "", monthlyReturn: "",
  contractDate: "", dueDate: "", status: "active", notes: "",
  manualScore: "",
  costCalc: { ...DEFAULT_COST_CALC },
};

function computeCosts(plot) {
  const cc = { ...DEFAULT_COST_CALC, ...(plot.costCalc || {}) };
  const contractAmount = Number(plot.contractAmount) || 0;
  const appraisedValue = Number(plot.appraisedValue) || 0;
  const marketValue = Number(cc.marketValue) || 0;
  const interestRate = Number(cc.interestRate) || 0;
  const prepaidMonths = Number(cc.prepaidMonths) || 0;
  const depositFeeSelfPct = Number(cc.depositFeeSelfPct) || 0;
  const brokerFeePct = Number(cc.brokerFeePct) || 0;
  const transferFeePct = Number(cc.transferFeePct) || 0;
  const stampDuty = Number(cc.stampDuty) || 0;
  const incomeTax = Number(cc.incomeTax) || 0;
  const contractMonths = Number(cc.contractMonths) || 12;

  const monthlyInterest = contractAmount * interestRate;
  const prepaidInterest = monthlyInterest * prepaidMonths;
  const depositFeeSelfAmt = contractAmount * depositFeeSelfPct;
  const brokerFeeAmt = contractAmount * brokerFeePct;
  const depositFeeTotalAmt = depositFeeSelfAmt + brokerFeeAmt;
  const transferFeeAmt = appraisedValue * transferFeePct;
  const taxTotal = transferFeeAmt + stampDuty + incomeTax;

  const lenderPaysFull = contractAmount - prepaidInterest - depositFeeTotalAmt;
  const lenderPaysSelfOnly = contractAmount - prepaidInterest - depositFeeSelfAmt;
  const sellerNet = contractAmount - prepaidInterest - depositFeeTotalAmt - taxTotal;

  const remainingMonths = Math.max(contractMonths - prepaidMonths, 0);
  const remainingInterest = remainingMonths * monthlyInterest;
  const redemptionAmount = contractAmount + remainingInterest;

  const profitIfRedeemed = redemptionAmount - lenderPaysSelfOnly;
  const roiIfRedeemed = lenderPaysSelfOnly ? profitIfRedeemed / lenderPaysSelfOnly : 0;
  const profitIfForeclosed = marketValue - lenderPaysSelfOnly;
  const roiIfForeclosed = lenderPaysSelfOnly ? profitIfForeclosed / lenderPaysSelfOnly : 0;

  return {
    cc, monthlyInterest, prepaidInterest, depositFeeSelfAmt, brokerFeeAmt, depositFeeTotalAmt,
    transferFeeAmt, taxTotal, lenderPaysFull, lenderPaysSelfOnly, sellerNet,
    remainingMonths, remainingInterest, redemptionAmount,
    profitIfRedeemed, roiIfRedeemed, profitIfForeclosed, roiIfForeclosed,
  };
}

function fmtPct(n) { return (Number(n) * 100).toLocaleString("th-TH", { maximumFractionDigits: 2 }) + "%"; }

function PlotForm({ initial, onSave, onCancel }) {
  const [f, setF] = useState({ ...initial, costCalc: { ...DEFAULT_COST_CALC, ...(initial.costCalc || {}) } });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const cc = f.costCalc;
  const setCC = (k) => (e) => setF({ ...f, costCalc: { ...cc, [k]: e.target.value } });
  const setCCPct = (k) => (e) => setF({ ...f, costCalc: { ...cc, [k]: Number(e.target.value) / 100 } });
  return (
    <div className="kf-in p-5 rounded-lg" style={{ background: C.panel, border: `1px solid ${C.line}` }}>
      <div className="kf-serif text-lg mb-3" style={{ color: C.ink }}>
        {initial.id ? "แก้ไขแปลง" : "เพิ่มแปลงที่รับฝากไว้"}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="ชื่อ/รหัสแปลง (เรียกเอง)">
          <input className="kf-sans px-3 py-2 rounded" style={inputStyle()} value={f.code} onChange={set("code")} placeholder="เช่น แปลงบางบัวทอง 1" />
        </Field>
        <Field label="ประเภทเอกสารสิทธิ์">
          <select className="kf-sans px-3 py-2 rounded" style={inputStyle()} value={f.deedType} onChange={set("deedType")}>
            <option>โฉนดที่ดิน</option>
            <option>นส.3ก</option>
            <option>นส.3</option>
            <option>ส.ค.1</option>
            <option>อื่นๆ</option>
          </select>
        </Field>
        <Field label="จังหวัด">
          <input className="kf-sans px-3 py-2 rounded" style={inputStyle()} value={f.province} onChange={set("province")} />
        </Field>
        <Field label="อำเภอ/เขต">
          <input className="kf-sans px-3 py-2 rounded" style={inputStyle()} value={f.district} onChange={set("district")} />
        </Field>
        <Field label="ตำบล/แขวง">
          <input className="kf-sans px-3 py-2 rounded" style={inputStyle()} value={f.subdistrict} onChange={set("subdistrict")} />
        </Field>
        <div className="grid grid-cols-3 gap-2">
          <Field label="ไร่"><input type="number" className="kf-sans px-2 py-2 rounded" style={inputStyle()} value={f.sizeRai} onChange={set("sizeRai")} /></Field>
          <Field label="งาน"><input type="number" className="kf-sans px-2 py-2 rounded" style={inputStyle()} value={f.sizeNgan} onChange={set("sizeNgan")} /></Field>
          <Field label="ตร.วา"><input type="number" className="kf-sans px-2 py-2 rounded" style={inputStyle()} value={f.sizeWah} onChange={set("sizeWah")} /></Field>
        </div>
        <Field label="ราคาประเมินราชการ (บาท)">
          <input type="number" className="kf-sans px-3 py-2 rounded" style={inputStyle()} value={f.appraisedValue} onChange={set("appraisedValue")} />
        </Field>
        <Field label="วงเงินขายฝาก (บาท)">
          <input type="number" className="kf-sans px-3 py-2 rounded" style={inputStyle()} value={f.contractAmount} onChange={set("contractAmount")} />
        </Field>
        <Field label="ค่าตอบแทน/ดอกเบี้ยต่อเดือน (บาท หรือ %)">
          <input className="kf-sans px-3 py-2 rounded" style={inputStyle()} value={f.monthlyReturn} onChange={set("monthlyReturn")} placeholder="เช่น 1.25%" />
        </Field>
        <Field label="วันที่ทำสัญญา">
          <input type="date" className="kf-sans px-3 py-2 rounded" style={inputStyle()} value={f.contractDate} onChange={set("contractDate")} />
        </Field>
        <Field label="วันครบกำหนดไถ่ถอน">
          <input type="date" className="kf-sans px-3 py-2 rounded" style={inputStyle()} value={f.dueDate} onChange={set("dueDate")} />
        </Field>
        <Field label="สถานะ">
          <select className="kf-sans px-3 py-2 rounded" style={inputStyle()} value={f.status} onChange={set("status")}>
            <option value="active">อยู่ในสัญญา</option>
            <option value="redeemed">ไถ่ถอนแล้ว</option>
            <option value="foreclosed">หลุดเป็นกรรมสิทธิ์</option>
          </select>
        </Field>
        <Field label="คะแนนที่คุณประเมินเอง (0-10 เช่น 8.5)">
          <input type="number" step="0.1" min="0" max="10" className="kf-sans px-3 py-2 rounded" style={inputStyle()} value={f.manualScore} onChange={set("manualScore")} placeholder="เช่น 8.5" />
        </Field>
        <div className="col-span-2">
          <Field label="หมายเหตุ">
            <textarea className="kf-sans px-3 py-2 rounded" style={inputStyle()} rows={2} value={f.notes} onChange={set("notes")} />
          </Field>
        </div>
      </div>

      <div className="kf-serif text-base mt-5 mb-2 pt-3" style={{ color: C.ink, borderTop: `1px solid ${C.line}` }}>
        รายละเอียดการคำนวณค่าใช้จ่ายขายฝาก
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="ราคาตลาด (บาท)">
          <input type="number" className="kf-sans px-3 py-2 rounded" style={inputStyle()} value={cc.marketValue} onChange={setCC("marketValue")} />
        </Field>
        <Field label="ระยะเวลาสัญญาทั้งหมด (เดือน)">
          <input type="number" className="kf-sans px-3 py-2 rounded" style={inputStyle()} value={cc.contractMonths} onChange={setCC("contractMonths")} />
        </Field>
        <Field label="อัตราดอกเบี้ยต่อเดือน (%)">
          <input type="number" step="0.01" className="kf-sans px-3 py-2 rounded" style={inputStyle()} value={cc.interestRate * 100} onChange={setCCPct("interestRate")} />
        </Field>
        <Field label="จำนวนเดือนหักดอกเบี้ยล่วงหน้า">
          <input type="number" className="kf-sans px-3 py-2 rounded" style={inputStyle()} value={cc.prepaidMonths} onChange={setCC("prepaidMonths")} />
        </Field>
        <Field label="ค่าปากถุงผู้รับซื้อฝากเอง (%)">
          <input type="number" step="0.01" className="kf-sans px-3 py-2 rounded" style={inputStyle()} value={cc.depositFeeSelfPct * 100} onChange={setCCPct("depositFeeSelfPct")} />
        </Field>
        <Field label="ค่านายหน้า (%)">
          <input type="number" step="0.01" className="kf-sans px-3 py-2 rounded" style={inputStyle()} value={cc.brokerFeePct * 100} onChange={setCCPct("brokerFeePct")} />
        </Field>
        <Field label="ค่าธรรมเนียมโอน (% ของราคาประเมิน)">
          <input type="number" step="0.01" className="kf-sans px-3 py-2 rounded" style={inputStyle()} value={cc.transferFeePct * 100} onChange={setCCPct("transferFeePct")} />
        </Field>
        <Field label="ค่าอากรแสตมป์ (บาท)">
          <input type="number" className="kf-sans px-3 py-2 rounded" style={inputStyle()} value={cc.stampDuty} onChange={setCC("stampDuty")} />
        </Field>
        <Field label="ภาษีเงินได้บุคคลธรรมดา (บาท)">
          <input type="number" className="kf-sans px-3 py-2 rounded" style={inputStyle()} value={cc.incomeTax} onChange={setCC("incomeTax")} />
        </Field>
      </div>
      <div className="kf-sans text-xs mt-2" style={{ color: C.inkSoft }}>
        ค่าโอนคำนวณจาก "ราคาประเมินราชการ" ด้านบน · ค่าอากรและภาษีเงินได้ควรตรวจสอบจากเว็บกรมที่ดินแล้วกรอกเป็นตัวเลขบาทตรงนี้
      </div>

      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onCancel} className="kf-sans px-4 py-2 rounded text-sm" style={{ color: C.inkSoft }}>ยกเลิก</button>
        <button
          onClick={() => onSave(f)}
          className="kf-sans px-4 py-2 rounded text-sm text-white"
          style={{ background: C.ink }}
        >
          บันทึก
        </button>
      </div>
    </div>
  );
}

function CostRow({ label, value, tone }) {
  const color = tone === "good" ? C.good : tone === "bad" ? C.bad : C.ink;
  return (
    <div className="flex justify-between kf-sans text-sm py-1" style={{ borderBottom: `1px dashed ${C.line}` }}>
      <span style={{ color: C.inkSoft }}>{label}</span>
      <span style={{ color, fontWeight: 600 }}>{value}</span>
    </div>
  );
}

function CostCalcPanel({ plot }) {
  const r = computeCosts(plot);
  return (
    <div className="kf-in mt-3 pt-3" style={{ borderTop: `1px dashed ${C.line}` }}>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="kf-sans text-xs font-medium mb-1" style={{ color: C.brass }}>ฝั่งผู้รับซื้อฝาก (นายทุน)</div>
          <CostRow label="ดอกเบี้ยต่อเดือน" value={fmtBaht(r.monthlyInterest)} />
          <CostRow label={`หักดอกเบี้ยล่วงหน้า (${r.cc.prepaidMonths} เดือน)`} value={"-" + fmtBaht(r.prepaidInterest)} />
          <CostRow label={`ค่าปากถุงรวม (${fmtPct(r.cc.depositFeeSelfPct + r.cc.brokerFeePct)})`} value={"-" + fmtBaht(r.depositFeeTotalAmt)} />
          <div className="kf-sans text-xs ml-2 mb-1" style={{ color: C.inkSoft }}>
            (ผู้รับซื้อฝากเอง {fmtBaht(r.depositFeeSelfAmt)} + นายหน้า {fmtBaht(r.brokerFeeAmt)})
          </div>
          <CostRow label="ต้องจ่ายจริง (หักค่าปากถุงรวมทั้งหมด)" value={fmtBaht(r.lenderPaysFull)} tone="good" />
          <CostRow label="หรือหักเฉพาะส่วนของตนเอง (นายหน้าจ่ายแยก)" value={fmtBaht(r.lenderPaysSelfOnly)} />
        </div>
        <div>
          <div className="kf-sans text-xs font-medium mb-1" style={{ color: C.brass }}>ฝั่งผู้ขายฝาก</div>
          <CostRow label="ค่าธรรมเนียมโอน" value={"-" + fmtBaht(r.transferFeeAmt)} />
          <CostRow label="ค่าอากรแสตมป์" value={"-" + fmtBaht(r.cc.stampDuty)} />
          <CostRow label="ภาษีเงินได้บุคคลธรรมดา" value={"-" + fmtBaht(r.cc.incomeTax)} />
          <CostRow label="รวมหักภาษี+ค่าโอน" value={"-" + fmtBaht(r.taxTotal)} />
          <CostRow label="ได้รับเงินสุทธิ" value={fmtBaht(r.sellerNet)} tone="good" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4 mt-3 pt-3" style={{ borderTop: `1px dashed ${C.line}` }}>
        <div>
          <CostRow label={`สินไถ่เมื่อครบกำหนด (${r.cc.contractMonths} เดือน)`} value={fmtBaht(r.redemptionAmount)} />
          <CostRow label="กำไรถ้าไถ่ถอน" value={fmtBaht(r.profitIfRedeemed)} tone="good" />
          <CostRow label="ROI ถ้าไถ่ถอน" value={fmtPct(r.roiIfRedeemed)} tone="good" />
        </div>
        <div>
          <CostRow label="กำไรถ้าหลุดเป็นกรรมสิทธิ์ (เทียบราคาตลาด)" value={fmtBaht(r.profitIfForeclosed)} tone="good" />
          <CostRow label="ROI ถ้าหลุดเป็นกรรมสิทธิ์" value={fmtPct(r.roiIfForeclosed)} tone="good" />
        </div>
      </div>
    </div>
  );
}

function ContractPhoto({ plotId }) {
  const [photo, setPhoto] = useState(null); // base64 data URL string, or null
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lightbox, setLightbox] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await storage.get(`plot_photo:${plotId}`);
        setPhoto(r ? r.value : null);
      } catch { setPhoto(null); }
      setReady(true);
    })();
  }, [plotId]);

  const handleFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (/heic|heif/i.test(file.type) || /\.hei[cf]$/i.test(file.name)) {
      setError("ไฟล์นี้เป็นสกุล HEIC/HEIF ซึ่งเบราว์เซอร์เปิดไม่ได้ กรุณาเปลี่ยนการตั้งค่ากล้องเป็นถ่ายรูปแบบ JPG ก่อน หรือแปลงไฟล์เป็น JPG แล้วลองใหม่");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setBusy(true);
    setError("");
    try {
      const dataUrl = await withTimeout(compressImage(file), 30000, "บีบอัดรูปนานเกินไป (เกิน 30 วินาที) ลองใช้รูปที่มีขนาดเล็กกว่านี้");
      if (dataUrl.length > 900000) {
        throw new Error("ไฟล์รูปใหญ่เกินไปแม้บีบอัดแล้ว ลองถ่ายรูปให้ห่างขึ้นหรือใช้รูปที่มีขนาดเล็กกว่านี้");
      }
      await withTimeout(storage.set(`plot_photo:${plotId}`, dataUrl), 30000, "บันทึกลงฐานข้อมูลนานเกินไป (เกิน 30 วินาที) เช็กอินเทอร์เน็ตแล้วลองใหม่");
      setPhoto(dataUrl);
    } catch (err) {
      setError("บันทึกรูปไม่สำเร็จ: " + (err.message || "ลองใหม่อีกครั้ง"));
    }
    setBusy(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removePhoto = async () => {
    try { await storage.delete(`plot_photo:${plotId}`); } catch { /* ignore */ }
    setPhoto(null);
  };

  const openPicker = () => {
    if (fileInputRef.current) fileInputRef.current.click();
  };

  if (!ready) return null;

  return (
    <div className="mt-3 pt-3" style={{ borderTop: `1px dashed ${C.line}` }}>
      <div className="kf-sans text-xs font-medium mb-2 flex items-center gap-1" style={{ color: C.brass }}>
        <Camera size={13} /> สัญญาขายฝาก (รูปถ่าย)
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: "none" }}
        onChange={handleFile}
        disabled={busy}
      />

      {photo ? (
        <div className="flex items-center gap-3">
          <img
            src={photo} alt="สัญญาขายฝาก"
            className="w-20 h-20 object-cover rounded cursor-pointer"
            style={{ border: `1px solid ${C.line}` }}
            onClick={() => setLightbox(true)}
          />
          <div className="flex flex-col gap-1">
            <button type="button" onClick={openPicker} className="kf-sans text-xs text-left" style={{ color: C.inkSoft }}>เปลี่ยนรูป</button>
            <button type="button" onClick={removePhoto} className="kf-sans text-xs text-left" style={{ color: C.bad }}>ลบรูป</button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={openPicker}
          disabled={busy}
          className="kf-sans text-xs px-3 py-2 rounded inline-flex items-center gap-1.5"
          style={{ background: C.panelDeep, color: C.inkSoft }}
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Camera size={13} />}
          {busy ? "กำลังบันทึกรูป..." : "ถ่าย/แนบรูปสัญญาขายฝาก"}
        </button>
      )}

      {error && <div className="kf-sans text-xs mt-2" style={{ color: C.bad }}>{error}</div>}

      {lightbox && photo && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-6"
          style={{ background: "rgba(20,26,18,0.85)" }}
          onClick={() => setLightbox(false)}
        >
          <img src={photo} alt="สัญญาขายฝาก" className="max-w-full max-h-full rounded" />
          <button onClick={() => setLightbox(false)} className="absolute top-4 right-4 text-white"><X size={22} /></button>
        </div>
      )}
    </div>
  );
}

function PlotCard({ plot, onEdit, onDelete }) {
  const [showCalc, setShowCalc] = useState(false);
  const notice = noticeStatus(plot.dueDate, plot.status);
  const statusLabel = { active: "อยู่ในสัญญา", redeemed: "ไถ่ถอนแล้ว", foreclosed: "หลุดเป็นกรรมสิทธิ์" }[plot.status];
  const statusTone = { active: "good", redeemed: "warn", foreclosed: "bad" }[plot.status];
  return (
    <div className="kf-in rounded-lg p-4 relative" style={{ background: C.panel, border: `1px solid ${C.line}` }}>
      <div className="flex justify-between items-start">
        <div>
          <div className="kf-serif text-base" style={{ color: C.ink }}>{plot.code || "(ไม่ระบุชื่อแปลง)"}</div>
          <div className="kf-sans text-xs flex items-center gap-1 mt-0.5" style={{ color: C.inkSoft }}>
            <MapPin size={12} /> {[plot.subdistrict, plot.district, plot.province].filter(Boolean).join(" / ") || "ไม่ระบุที่ตั้ง"}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <Seal tone={statusTone}>{statusLabel}</Seal>
          {plot.manualScore !== "" && plot.manualScore !== undefined && plot.manualScore !== null && (
            <Seal tone={Number(plot.manualScore) >= 9 ? "good" : Number(plot.manualScore) >= 6 ? "warn" : "bad"}>
              คะแนน {Number(plot.manualScore).toFixed(1)}
            </Seal>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-3 kf-sans text-sm" style={{ color: C.ink }}>
        <div className="flex items-center gap-1" style={{ color: C.inkSoft }}><FileText size={13} /> {plot.deedType}</div>
        <div className="flex items-center gap-1" style={{ color: C.inkSoft }}>
          {plot.sizeRai || 0} ไร่ {plot.sizeNgan || 0} งาน {plot.sizeWah || 0} ตร.วา
        </div>
        <div className="flex items-center gap-1"><Coins size={13} style={{ color: C.brass }} /> วงเงิน {fmtBaht(plot.contractAmount)}</div>
        <div className="flex items-center gap-1"><Coins size={13} style={{ color: C.brass }} /> ประเมิน {fmtBaht(plot.appraisedValue)}</div>
        <div className="flex items-center gap-1"><Calendar size={13} /> ทำสัญญา {fmtDate(plot.contractDate)}</div>
        <div className="flex items-center gap-1"><Calendar size={13} /> ครบกำหนด {fmtDate(plot.dueDate)}</div>
      </div>

      {plot.notes && <div className="kf-sans text-xs mt-2 italic" style={{ color: C.inkSoft }}>{plot.notes}</div>}

      {notice && (
        <div className="kf-sans text-xs mt-3 px-2 py-1.5 rounded flex items-start gap-1.5" style={{
          background: notice.level === "good" ? "#E4EFE4" : notice.level === "warn" ? "#F5EAD4" : notice.level === "bad" ? "#F3E0DD" : C.panelDeep,
          color: notice.level === "good" ? C.good : notice.level === "warn" ? C.warn : notice.level === "bad" ? C.bad : C.inkSoft,
        }}>
          <Clock size={13} className="mt-0.5 shrink-0" /> {notice.text}
        </div>
      )}

      <div className="flex justify-between items-center mt-3">
        <button onClick={() => setShowCalc(!showCalc)} className="kf-sans text-xs flex items-center gap-1" style={{ color: C.brass }}>
          <Coins size={12} /> {showCalc ? "ซ่อนรายละเอียดค่าใช้จ่าย" : "ดูรายละเอียดค่าใช้จ่าย/ผลตอบแทน"}
        </button>
        <div className="flex gap-3">
          <button onClick={() => onEdit(plot)} className="kf-sans text-xs flex items-center gap-1" style={{ color: C.inkSoft }}><Pencil size={12} /> แก้ไข</button>
          <button onClick={() => onDelete(plot.id)} className="kf-sans text-xs flex items-center gap-1" style={{ color: C.bad }}><Trash2 size={12} /> ลบ</button>
        </div>
      </div>

      {showCalc && <CostCalcPanel plot={plot} />}
      <ContractPhoto plotId={plot.id} />
    </div>
  );
}

function NoticeAlerts({ plots }) {
  const order = { bad: 0, warn: 1, good: 2 };
  const alerts = plots
    .map((p) => ({ plot: p, notice: noticeStatus(p.dueDate, p.status) }))
    .filter((x) => x.notice && x.notice.level !== "info")
    .sort((a, b) => order[a.notice.level] - order[b.notice.level]);

  if (alerts.length === 0) return null;

  return (
    <div className="kf-in rounded-lg p-4 mb-4" style={{ background: "#F5EAD4", border: `1px solid ${C.warn}` }}>
      <div className="kf-serif text-sm mb-2 flex items-center gap-1.5" style={{ color: C.warn }}>
        <AlertTriangle size={15} /> แจ้งเตือนกำหนดหนังสือแจ้งครบกำหนดไถ่ถอน (ตามกฎหมาย 3-6 เดือนก่อนครบกำหนด)
      </div>
      <div className="grid gap-1.5">
        {alerts.map(({ plot, notice }) => (
          <div key={plot.id} className="kf-sans text-sm flex justify-between gap-3" style={{ color: C.ink }}>
            <span>{plot.code || "(ไม่ระบุชื่อแปลง)"}</span>
            <span
              className="text-right"
              style={{ color: notice.level === "bad" ? C.bad : notice.level === "good" ? C.good : C.warn, fontWeight: 600 }}
            >
              {notice.text}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PortfolioTab({ plots, setPlots }) {
  const [editing, setEditing] = useState(null); // null | 'new' | plot object

  const save = (f) => {
    if (f.id) {
      setPlots(plots.map((p) => (p.id === f.id ? f : p)));
    } else {
      setPlots([...plots, { ...f, id: uid() }]);
    }
    setEditing(null);
  };
  const del = (id) => setPlots(plots.filter((p) => p.id !== id));

  const totals = plots.reduce(
    (a, p) => ({
      contract: a.contract + (Number(p.contractAmount) || 0),
      appraised: a.appraised + (Number(p.appraisedValue) || 0),
    }),
    { contract: 0, appraised: 0 }
  );

  return (
    <div className="kf-in">
      <div className="flex items-center justify-between mb-4">
        <div className="grid grid-cols-3 gap-3 flex-1">
          <div className="rounded-lg p-3" style={{ background: C.panel, border: `1px solid ${C.line}` }}>
            <div className="kf-sans text-xs" style={{ color: C.inkSoft }}>จำนวนแปลงในพอร์ต</div>
            <div className="kf-serif text-xl" style={{ color: C.ink }}>{plots.length}</div>
          </div>
          <div className="rounded-lg p-3" style={{ background: C.panel, border: `1px solid ${C.line}` }}>
            <div className="kf-sans text-xs" style={{ color: C.inkSoft }}>วงเงินขายฝากรวม</div>
            <div className="kf-serif text-xl" style={{ color: C.brass }}>{fmtBaht(totals.contract)}</div>
          </div>
          <div className="rounded-lg p-3" style={{ background: C.panel, border: `1px solid ${C.line}` }}>
            <div className="kf-sans text-xs" style={{ color: C.inkSoft }}>ราคาประเมินรวม</div>
            <div className="kf-serif text-xl" style={{ color: C.ink }}>{fmtBaht(totals.appraised)}</div>
          </div>
        </div>
      </div>

      <NoticeAlerts plots={plots} />

      {editing === "new" && <div className="mb-4"><PlotForm initial={EMPTY_PLOT} onSave={save} onCancel={() => setEditing(null)} /></div>}
      {editing && editing !== "new" && <div className="mb-4"><PlotForm initial={editing} onSave={save} onCancel={() => setEditing(null)} /></div>}

      {!editing && (
        <button
          onClick={() => setEditing("new")}
          className="kf-sans flex items-center gap-1.5 px-4 py-2 rounded mb-4 text-sm text-white"
          style={{ background: C.ink }}
        >
          <Plus size={15} /> เพิ่มแปลงที่รับฝากไว้
        </button>
      )}

      {plots.length === 0 && !editing && (
        <div className="kf-sans text-sm text-center py-10" style={{ color: C.inkSoft }}>
          ยังไม่มีแปลงในพอร์ต — กดปุ่มด้านบนเพื่อบันทึกแปลงที่รับฝากไว้
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        {plots.map((p) => (
          <PlotCard key={p.id} plot={p} onEdit={setEditing} onDelete={del} />
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------
   ANALYSIS TAB
--------------------------------------------------------- */
const EMPTY_BROKER = {
  province: "", district: "", sizeRai: "", deedType: "โฉนดที่ดิน",
  askingPrice: "", appraisedValue: "", features: "",
};
const EMPTY_SEARCH = { province: "", budget: "", sizeWanted: "", purpose: "" };

function normalizeAnalysis(r) {
  return {
    overall_score: typeof r.overall_score === "number" ? r.overall_score : 0,
    verdict: r.verdict || "ไม่ทราบผล (ข้อมูลไม่ครบ)",
    summary: r.summary || "การวิเคราะห์ไม่สมบูรณ์ ข้อมูลบางส่วนอาจถูกตัดขาด ลองวิเคราะห์ใหม่อีกครั้ง",
    categories: Array.isArray(r.categories) ? r.categories : [],
    market_price_estimate: r.market_price_estimate || { low: 0, high: 0, unit: "ไม่ทราบ" },
    resale: {
      quick_sale: (r.resale && r.resale.quick_sale) || { price: 0, timeframe: "-", note: "ไม่มีข้อมูล" },
      optimal_sale: (r.resale && r.resale.optimal_sale) || { price: 0, timeframe: "-", note: "ไม่มีข้อมูล" },
    },
  };
}

function AnalysisResult({ result: raw, sourceLabel, onSaveHistory, threshold = 9.0 }) {
  const result = normalizeAnalysis(raw);
  const pass = result.overall_score >= threshold;
  return (
    <div className="kf-in mt-5 rounded-lg p-5" style={{ background: C.panel, border: `1px solid ${C.line}` }}>
      <div className="flex items-center justify-between mb-3">
        <Seal tone={sourceLabel === "นายหน้าเสนอ" ? "warn" : "good"}>{sourceLabel}</Seal>
        <Seal tone={pass ? "good" : "bad"}>
          {pass ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
          {pass ? `น่าลงทุน (≥ ${threshold.toFixed(1)})` : `ยังไม่ถึงเกณฑ์ ${threshold.toFixed(1)}`}
        </Seal>
      </div>

      <ScoreGauge score={result.overall_score} threshold={threshold} />
      <div className="kf-sans text-sm mt-2" style={{ color: C.inkSoft }}>{result.verdict} — {result.summary}</div>

      <div className="mt-4 pt-3" style={{ borderTop: `1px solid ${C.line}` }}>
        {result.categories.map((c) => {
          const label = (CATEGORY_LABELS.find(([k]) => k === c.key) || [null, c.key])[1];
          return <CategoryBar key={c.key} label={label} score={c.score} note={c.note} />;
        })}
      </div>

      <div className="grid grid-cols-2 gap-3 mt-4">
        <div className="rounded p-3" style={{ background: C.panelDeep }}>
          <div className="kf-sans text-xs mb-1" style={{ color: C.inkSoft }}>ราคาตลาดโดยประมาณ</div>
          <div className="kf-serif text-base" style={{ color: C.ink }}>
            {fmtBaht(result.market_price_estimate.low)} – {fmtBaht(result.market_price_estimate.high)}
          </div>
          <div className="kf-sans text-xs" style={{ color: C.inkSoft }}>{result.market_price_estimate.unit}</div>
        </div>
        <div className="rounded p-3" style={{ background: "#F3E0DD" }}>
          <div className="kf-sans text-xs mb-1" style={{ color: C.bad }}>หากขายเร็ว (ขายด่วน)</div>
          <div className="kf-serif text-base" style={{ color: C.bad }}>{fmtBaht(result.resale.quick_sale.price)}</div>
          <div className="kf-sans text-xs" style={{ color: C.inkSoft }}>{result.resale.quick_sale.timeframe} — {result.resale.quick_sale.note}</div>
        </div>
        <div className="rounded p-3 col-span-2" style={{ background: "#E4EFE4" }}>
          <div className="kf-sans text-xs mb-1" style={{ color: C.good }}>หากขายแบบเหมาะสม (รอราคาดี)</div>
          <div className="kf-serif text-base" style={{ color: C.good }}>{fmtBaht(result.resale.optimal_sale.price)}</div>
          <div className="kf-sans text-xs" style={{ color: C.inkSoft }}>{result.resale.optimal_sale.timeframe} — {result.resale.optimal_sale.note}</div>
        </div>
      </div>

      <div className="flex justify-end mt-4">
        <button onClick={onSaveHistory} className="kf-sans text-sm px-4 py-2 rounded text-white flex items-center gap-1.5" style={{ background: C.ink }}>
          <Archive size={14} /> บันทึกลงประวัติการวิเคราะห์
        </button>
      </div>
    </div>
  );
}

function buildAnalysisPrompt(f) {
  return `วิเคราะห์ที่ดินแปลงนี้สำหรับการตัดสินใจรับซื้อฝาก (ขายฝาก) ในประเทศไทย โดยประเมินทุกด้านอย่างครบถ้วน:
จังหวัด: ${f.province || "ไม่ระบุ"}
อำเภอ: ${f.district || "ไม่ระบุ"}
ขนาด: ${f.sizeRai || "ไม่ระบุ"} ไร่
ประเภทเอกสารสิทธิ์: ${f.deedType || "ไม่ระบุ"}
ราคาที่เสนอ/ต้องการวงเงิน: ${f.askingPrice || "ไม่ระบุ"} บาท
ราคาประเมินราชการ (ถ้ามี): ${f.appraisedValue || "ไม่ทราบ"} บาท
รายละเอียด/จุดเด่น/ข้อจำกัด: ${f.features || "ไม่มีข้อมูลเพิ่มเติม"}

ให้คะแนนแต่ละด้าน (0-10) ได้แก่ ทำเลและศักยภาพ, ราคาต่อรองเทียบราคาตลาด, เอกสารสิทธิ์และกฎหมาย, สภาพคล่องในการขายต่อ, แนวโน้มมูลค่าในอนาคต, ความเสี่ยงและข้อจำกัด, ผลตอบแทนกรณีหลุดเป็นกรรมสิทธิ์ ในหัวข้อ "ความเสี่ยงและข้อจำกัด" ต้องตรวจสอบและระบุสีผังเมือง/ประเภทการใช้ประโยชน์ที่ดินตามกฎกระทรวงผังเมืองรวมของพื้นที่นั้น (เช่น เขตเกษตรกรรม เขตอนุรักษ์ชนบทและเกษตรกรรม เขตที่อยู่อาศัย เขตอุตสาหกรรม หรือข้อห้าม/ข้อจำกัดการก่อสร้างและการใช้ประโยชน์ที่ดิน) และนำผลกระทบต่อมูลค่าและการขายต่อมาคิดรวมในคะแนนด้วย แล้วสรุปคะแนนรวม เกณฑ์ 9.0 ขึ้นไปถือว่าน่าลงทุน พร้อมประเมินราคาตลาด และประเมินราคาขายต่อ 2 แบบ คือขายเร็ว(ขายด่วน)กับขายแบบเหมาะสม(รอราคาดี) กรณีที่ดินหลุดเป็นกรรมสิทธิ์ของผู้รับซื้อฝาก ค้นข้อมูลราคาที่ดินในย่านนั้นจากอินเทอร์เน็ตประกอบการประเมินถ้าเป็นไปได้

${ANALYSIS_SCHEMA_NOTE}`;
}

async function analyzeLand(f, useSearch = true) {
  return callClaude({
    system: "คุณคือผู้เชี่ยวชาญประเมินที่ดินและความเสี่ยงธุรกิจขายฝากในประเทศไทย ตอบเป็น JSON เท่านั้น",
    prompt: buildAnalysisPrompt(f),
    useSearch,
  });
}

function AnalysisTab({ history, setHistory }) {
  const [mode, setMode] = useState("broker"); // 'broker' | 'ai'
  const [brokerForm, setBrokerForm] = useState(EMPTY_BROKER);
  const [searchForm, setSearchForm] = useState(EMPTY_SEARCH);
  const [candidates, setCandidates] = useState(null);
  const [selected, setSelected] = useState(null);
  const [searching, setSearching] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const setB = (k) => (e) => setBrokerForm({ ...brokerForm, [k]: e.target.value });
  const setS = (k) => (e) => setSearchForm({ ...searchForm, [k]: e.target.value });

  const runSearch = async () => {
    setSearching(true); setError(""); setCandidates(null); setSelected(null); setResult(null);
    try {
      const prompt = `ช่วยค้นหา "ประกาศขายฝากที่ดิน" จริงในประเทศไทยที่ตรงกับเกณฑ์ต่อไปนี้ — คือที่ดินที่เจ้าของประกาศต้องการทำสัญญาขายฝาก (ไม่ใช่ขายขาด) เพื่อรับเงินก้อนจากนักลงทุน/นายทุนที่รับซื้อฝาก ค้นจากเว็บ/กลุ่มที่มีประกาศขายฝากที่ดินโดยเฉพาะ เช่น กลุ่มเฟซบุ๊กขายฝากที่ดิน, เว็บขายฝากที่ดินทั่วไทย, หรือประกาศบนเว็บอสังหาทั่วไป (DDproperty, Kaidee, Baania) ที่ระบุชัดเจนว่าเป็น "ขายฝาก" ไม่ใช่ "ขายขาด" — ถ้าหาประกาศขายฝากโดยตรงไม่พบเพียงพอ ให้ระบุในผลลัพธ์ว่าแปลงนั้นเป็นที่ดินขายขาดทั่วไปที่อาจเสนอเปลี่ยนเป็นขายฝากได้ (ไม่ใช่ประกาศขายฝากจริง) ในช่อง highlight:
จังหวัด/พื้นที่ที่สนใจ: ${searchForm.province || "ไม่ระบุ"}
งบประมาณ (วงเงินที่จะปล่อยขายฝาก): ${searchForm.budget || "ไม่ระบุ"} บาท
ขนาดที่ดินที่ต้องการ: ${searchForm.sizeWanted || "ไม่ระบุ"} ไร่
เงื่อนไข/วัตถุประสงค์เพิ่มเติม: ${searchForm.purpose || "ไม่มี"}

หาแปลงจริง 3-5 แปลงที่ใกล้เคียงเกณฑ์ที่สุด โดยให้ความสำคัญกับประกาศ "ขายฝาก" จริงก่อนเสมอ ตอบเป็น JSON ล้วนเท่านั้น ห้ามข้อความอื่น ห้าม markdown code fence โครงสร้าง:
{"candidates":[{"title":"...","location":"...","size":"...","price":"...","deedType":"...","source_url":"...","highlight":"จุดเด่นสั้นๆ ระบุด้วยว่าเป็นประกาศขายฝากจริงหรือเป็นขายขาดที่อาจเสนอขายฝากได้"}]}`;
      const data = await callClaude({
        system: "คุณคือผู้ช่วยสืบค้นประกาศขายฝากที่ดิน (sale with right of redemption) จริงในประเทศไทย สำหรับนักลงทุนที่รับซื้อฝากที่ดิน ไม่ใช่ผู้ที่ต้องการซื้อที่ดินขาด ตอบเป็น JSON เท่านั้น",
        prompt, useSearch: true,
      });
      setCandidates(data.candidates || []);
    } catch (e) {
      setError("ค้นหาที่ดินไม่สำเร็จ: " + (e.message || "ลองใหม่อีกครั้ง หรือปรับเกณฑ์การค้นหา"));
    } finally { setSearching(false); }
  };

  const pickCandidate = (c) => {
    setSelected(c);
    setBrokerForm({
      province: c.location || "",
      district: "",
      sizeRai: c.size || "",
      deedType: c.deedType || "โฉนดที่ดิน",
      askingPrice: c.price || "",
      appraisedValue: "",
      features: c.highlight || "",
    });
  };

  const runAnalysis = async () => {
    setAnalyzing(true); setError(""); setResult(null);
    try {
      const data = await analyzeLand(brokerForm);
      setResult(data);
    } catch (e) {
      setError("วิเคราะห์ไม่สำเร็จ: " + (e.message || "ลองใหม่อีกครั้ง"));
    } finally { setAnalyzing(false); }
  };

  const saveToHistory = () => {
    if (!result) return;
    setHistory([{ id: uid(), date: new Date().toISOString(), source: mode, form: brokerForm, result }, ...history]);
  };

  return (
    <div className="kf-in">
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => { setMode("broker"); setResult(null); setError(""); }}
          className="kf-sans text-sm px-4 py-2 rounded-full"
          style={mode === "broker" ? { background: C.ink, color: "#fff" } : { background: C.panel, color: C.inkSoft, border: `1px solid ${C.line}` }}
        >
          มีนายหน้าเสนอที่ดินมาให้
        </button>
        <button
          onClick={() => { setMode("ai"); setResult(null); setError(""); }}
          className="kf-sans text-sm px-4 py-2 rounded-full flex items-center gap-1"
          style={mode === "ai" ? { background: C.ink, color: "#fff" } : { background: C.panel, color: C.inkSoft, border: `1px solid ${C.line}` }}
        >
          <Sparkles size={13} /> ให้ AI ช่วยหาที่ดิน
        </button>
      </div>

      {mode === "ai" && !selected && (
        <div className="rounded-lg p-5 mb-4" style={{ background: C.panel, border: `1px solid ${C.line}` }}>
          <div className="kf-serif text-base mb-3" style={{ color: C.ink }}>เกณฑ์ที่ต้องการให้ AI ช่วยหาที่ดิน</div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="จังหวัด/พื้นที่ที่สนใจ"><input className="kf-sans px-3 py-2 rounded" style={inputStyle()} value={searchForm.province} onChange={setS("province")} /></Field>
            <Field label="งบประมาณ/วงเงินที่จะปล่อย (บาท)"><input type="number" className="kf-sans px-3 py-2 rounded" style={inputStyle()} value={searchForm.budget} onChange={setS("budget")} /></Field>
            <Field label="ขนาดที่ดินที่ต้องการ (ไร่)"><input type="number" className="kf-sans px-3 py-2 rounded" style={inputStyle()} value={searchForm.sizeWanted} onChange={setS("sizeWanted")} /></Field>
            <Field label="เงื่อนไข/วัตถุประสงค์อื่นๆ"><input className="kf-sans px-3 py-2 rounded" style={inputStyle()} value={searchForm.purpose} onChange={setS("purpose")} placeholder="เช่น ติดถนนใหญ่, ใกล้นิคมอุตสาหกรรม" /></Field>
          </div>
          <button onClick={runSearch} disabled={searching} className="kf-sans mt-4 px-4 py-2 rounded text-sm text-white flex items-center gap-1.5" style={{ background: C.ink, opacity: searching ? 0.6 : 1 }}>
            {searching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
            {searching ? "กำลังค้นหา..." : "ค้นหาที่ดิน"}
          </button>
        </div>
      )}

      {mode === "ai" && candidates && !selected && (
        <div className="grid gap-3 mb-4">
          {candidates.length === 0 && <div className="kf-sans text-sm" style={{ color: C.inkSoft }}>ไม่พบแปลงที่ตรงเกณฑ์ ลองปรับเกณฑ์การค้นหา</div>}
          {candidates.map((c, i) => (
            <div key={i} className="kf-in rounded-lg p-4 flex justify-between items-start" style={{ background: C.panel, border: `1px solid ${C.line}` }}>
              <div>
                <div className="kf-serif text-sm" style={{ color: C.ink }}>{c.title}</div>
                <div className="kf-sans text-xs mt-1" style={{ color: C.inkSoft }}>{c.location} · {c.size} ไร่ · {c.deedType}</div>
                <div className="kf-sans text-sm mt-1" style={{ color: C.brass }}>{c.price}</div>
                <div className="kf-sans text-xs mt-1" style={{ color: C.inkSoft }}>{c.highlight}</div>
                {c.source_url && (
                  <a href={c.source_url} target="_blank" rel="noreferrer" className="kf-sans text-xs mt-1 flex items-center gap-1" style={{ color: C.seal }}>
                    <ExternalLink size={11} /> ดูประกาศต้นทาง
                  </a>
                )}
              </div>
              <button onClick={() => pickCandidate(c)} className="kf-sans text-xs px-3 py-1.5 rounded text-white shrink-0 flex items-center gap-1" style={{ background: C.ink }}>
                เลือกวิเคราะห์ <ChevronRight size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {(mode === "broker" || (mode === "ai" && selected)) && (
        <div className="rounded-lg p-5 mb-2" style={{ background: C.panel, border: `1px solid ${C.line}` }}>
          <div className="flex items-center justify-between mb-3">
            <div className="kf-serif text-base" style={{ color: C.ink }}>
              {mode === "ai" ? "ข้อมูลแปลงที่เลือก (แก้ไขเพิ่มเติมได้)" : "รายละเอียดที่ดินที่นายหน้าเสนอ"}
            </div>
            {mode === "ai" && (
              <button onClick={() => { setSelected(null); setResult(null); }} className="kf-sans text-xs" style={{ color: C.inkSoft }}>← เลือกแปลงอื่น</button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="จังหวัด"><input className="kf-sans px-3 py-2 rounded" style={inputStyle()} value={brokerForm.province} onChange={setB("province")} /></Field>
            <Field label="อำเภอ"><input className="kf-sans px-3 py-2 rounded" style={inputStyle()} value={brokerForm.district} onChange={setB("district")} /></Field>
            <Field label="ขนาด (ไร่)"><input className="kf-sans px-3 py-2 rounded" style={inputStyle()} value={brokerForm.sizeRai} onChange={setB("sizeRai")} /></Field>
            <Field label="ประเภทเอกสารสิทธิ์">
              <select className="kf-sans px-3 py-2 rounded" style={inputStyle()} value={brokerForm.deedType} onChange={setB("deedType")}>
                <option>โฉนดที่ดิน</option><option>นส.3ก</option><option>นส.3</option><option>ส.ค.1</option><option>อื่นๆ</option>
              </select>
            </Field>
            <Field label="ราคาที่เสนอ/วงเงินที่ต้องการ (บาท)"><input className="kf-sans px-3 py-2 rounded" style={inputStyle()} value={brokerForm.askingPrice} onChange={setB("askingPrice")} /></Field>
            <Field label="ราคาประเมินราชการ (ถ้ามี)"><input className="kf-sans px-3 py-2 rounded" style={inputStyle()} value={brokerForm.appraisedValue} onChange={setB("appraisedValue")} /></Field>
            <div className="col-span-2">
              <Field label="รายละเอียด/จุดเด่น/ข้อจำกัด">
                <textarea className="kf-sans px-3 py-2 rounded" style={inputStyle()} rows={2} value={brokerForm.features} onChange={setB("features")} placeholder="เช่น ติดถนนลาดยาง, รูปแปลงสวย, ใกล้ชุมชน, ทางเข้าแคบ ฯลฯ" />
              </Field>
            </div>
          </div>
          <button onClick={runAnalysis} disabled={analyzing} className="kf-sans mt-4 px-4 py-2 rounded text-sm text-white flex items-center gap-1.5" style={{ background: C.ink, opacity: analyzing ? 0.6 : 1 }}>
            {analyzing ? <Loader2 size={14} className="animate-spin" /> : <TrendingUp size={14} />}
            {analyzing ? "กำลังวิเคราะห์..." : "วิเคราะห์ที่ดินด้วย AI"}
          </button>
        </div>
      )}

      {error && <div className="kf-sans text-sm mt-2" style={{ color: C.bad }}>{error}</div>}

      {result && (
        <AnalysisResult
          result={result}
          sourceLabel={mode === "ai" ? "AI ค้นหาให้" : "นายหน้าเสนอ"}
          onSaveHistory={saveToHistory}
        />
      )}
    </div>
  );
}

const INVEST_THRESHOLD = 8.5;

function RecommendedCard({ candidate, result: rawResult, onSave }) {
  const result = normalizeAnalysis(rawResult);
  return (
    <div className="kf-in rounded-lg p-4" style={{ background: C.panel, border: `1px solid ${C.good}` }}>
      <div className="flex justify-between items-start mb-2">
        <div>
          <div className="kf-serif text-sm" style={{ color: C.ink }}>{candidate.title}</div>
          <div className="kf-sans text-xs mt-0.5" style={{ color: C.inkSoft }}>{candidate.location} · {candidate.size} ไร่ · {candidate.deedType}</div>
          <div className="kf-sans text-sm mt-1" style={{ color: C.brass }}>{candidate.price}</div>
        </div>
        <Seal tone="good"><Star size={12} /> น่าลงทุน</Seal>
      </div>

      <ScoreGauge score={result.overall_score} threshold={INVEST_THRESHOLD} />
      <div className="kf-sans text-xs mt-2" style={{ color: C.inkSoft }}>{result.summary}</div>

      <div className="grid grid-cols-2 gap-3 mt-3">
        <div className="rounded p-2" style={{ background: "#F3E0DD" }}>
          <div className="kf-sans text-[11px]" style={{ color: C.bad }}>ขายเร็ว</div>
          <div className="kf-serif text-sm" style={{ color: C.bad }}>{fmtBaht(result.resale.quick_sale.price)}</div>
        </div>
        <div className="rounded p-2" style={{ background: "#E4EFE4" }}>
          <div className="kf-sans text-[11px]" style={{ color: C.good }}>ขายแบบเหมาะสม</div>
          <div className="kf-serif text-sm" style={{ color: C.good }}>{fmtBaht(result.resale.optimal_sale.price)}</div>
        </div>
      </div>

      <div className="flex justify-between items-center mt-3">
        {candidate.source_url ? (
          <a href={candidate.source_url} target="_blank" rel="noreferrer" className="kf-sans text-xs flex items-center gap-1" style={{ color: C.seal }}>
            <ExternalLink size={11} /> ดูประกาศต้นทาง
          </a>
        ) : <span />}
        <button onClick={onSave} className="kf-sans text-xs px-3 py-1.5 rounded text-white flex items-center gap-1" style={{ background: C.ink }}>
          <Archive size={12} /> บันทึกลงประวัติ
        </button>
      </div>
    </div>
  );
}

function RecommendedTab({ history, setHistory }) {
  const [form, setForm] = useState(EMPTY_SEARCH);
  const setF = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const [results, setResults] = useState(null); // qualifying [{candidate, result}]
  const [skipped, setSkipped] = useState(0);
  const [error, setError] = useState("");

  const run = async () => {
    setRunning(true); setError(""); setResults(null); setSkipped(0);
    try {
      setProgress("กำลังสรรหาที่ดินตามเกณฑ์...");
      const searchPrompt = `ช่วยค้นหา "ประกาศขายฝากที่ดิน" จริงในประเทศไทยที่ตรงกับเกณฑ์ต่อไปนี้ — คือที่ดินที่เจ้าของประกาศต้องการทำสัญญาขายฝาก (ไม่ใช่ขายขาด) เพื่อรับเงินก้อนจากนักลงทุน/นายทุนที่รับซื้อฝาก ค้นจากเว็บ/กลุ่มที่มีประกาศขายฝากที่ดินโดยเฉพาะ เช่น กลุ่มเฟซบุ๊กขายฝากที่ดิน, เว็บขายฝากที่ดินทั่วไทย, หรือประกาศบนเว็บอสังหาทั่วไป (DDproperty, Kaidee, Baania) ที่ระบุชัดเจนว่าเป็น "ขายฝาก" ไม่ใช่ "ขายขาด" — ถ้าหาประกาศขายฝากโดยตรงไม่พบเพียงพอ ให้ระบุในผลลัพธ์ว่าแปลงนั้นเป็นที่ดินขายขาดทั่วไปที่อาจเสนอเปลี่ยนเป็นขายฝากได้ (ไม่ใช่ประกาศขายฝากจริง) ในช่อง highlight:
จังหวัด/พื้นที่ที่สนใจ: ${form.province || "ไม่ระบุ (เลือกทำเลที่มีศักยภาพทั่วไทย)"}
งบประมาณ (วงเงินที่จะปล่อยขายฝาก): ${form.budget || "ไม่ระบุ"} บาท
ขนาดที่ดินที่ต้องการ: ${form.sizeWanted || "ไม่ระบุ"} ไร่
เงื่อนไข/วัตถุประสงค์เพิ่มเติม: ${form.purpose || "ไม่มี"}

หาแปลงจริง 4 แปลงที่น่าสนใจที่สุด โดยให้ความสำคัญกับประกาศ "ขายฝาก" จริงก่อนเสมอ ตอบเป็น JSON ล้วนเท่านั้น ห้ามข้อความอื่น ห้าม markdown code fence โครงสร้าง:
{"candidates":[{"title":"...","location":"...","size":"...","price":"...","deedType":"...","source_url":"...","highlight":"จุดเด่นสั้นๆ ระบุด้วยว่าเป็นประกาศขายฝากจริงหรือเป็นขายขาดที่อาจเสนอขายฝากได้"}]}`;
      const searchData = await callClaude({
        system: "คุณคือผู้ช่วยสืบค้นประกาศขายฝากที่ดิน (sale with right of redemption) จริงในประเทศไทย สำหรับนักลงทุนที่รับซื้อฝากที่ดิน ไม่ใช่ผู้ที่ต้องการซื้อที่ดินขาด ตอบเป็น JSON เท่านั้น",
        prompt: searchPrompt, useSearch: true,
      });
      const candidates = (searchData.candidates || []).slice(0, 4);

      const qualifying = [];
      let skippedCount = 0;
      for (let i = 0; i < candidates.length; i++) {
        const c = candidates[i];
        setProgress(`กำลังประเมินแปลงที่ ${i + 1} จาก ${candidates.length}: ${c.title || ""}`);
        if (i > 0) await new Promise((r) => setTimeout(r, 2000));
        try {
          const result = await analyzeLand({
            province: c.location, district: "", sizeRai: c.size, deedType: c.deedType,
            askingPrice: c.price, appraisedValue: "", features: c.highlight,
          }, false);
          if (result.overall_score >= INVEST_THRESHOLD) {
            qualifying.push({ candidate: c, result });
          } else {
            skippedCount++;
          }
        } catch { skippedCount++; }
      }
      setResults(qualifying);
      setSkipped(skippedCount);
    } catch (e) {
      setError("สรรหาที่ดินไม่สำเร็จ: " + (e.message || "ลองใหม่อีกครั้ง"));
    } finally { setRunning(false); setProgress(""); }
  };

  const saveOne = (candidate, result) => {
    setHistory([{ id: uid(), date: new Date().toISOString(), source: "ai-recommended", form: { province: candidate.location, district: "", sizeRai: candidate.size }, result }, ...history]);
  };

  return (
    <div className="kf-in">
      <div className="rounded-lg p-5 mb-4" style={{ background: C.panel, border: `1px solid ${C.line}` }}>
        <div className="kf-serif text-base mb-1 flex items-center gap-1.5" style={{ color: C.ink }}>
          <Star size={16} style={{ color: C.good }} /> ที่ดินน่าลงทุนที่ AI สรรหามาเสนอ
        </div>
        <div className="kf-sans text-xs mb-3" style={{ color: C.inkSoft }}>
          AI จะค้นหาที่ดินจริงตามเกณฑ์ที่ตั้งไว้ ให้คะแนนทุกด้านให้อัตโนมัติ แล้วแสดงเฉพาะแปลงที่คะแนนรวมถึงเกณฑ์ {INVEST_THRESHOLD.toFixed(1)} ขึ้นไปเท่านั้น
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="จังหวัด/พื้นที่ที่สนใจ (เว้นว่างได้)"><input className="kf-sans px-3 py-2 rounded" style={inputStyle()} value={form.province} onChange={setF("province")} /></Field>
          <Field label="งบประมาณ/วงเงินที่จะปล่อย (บาท)"><input type="number" className="kf-sans px-3 py-2 rounded" style={inputStyle()} value={form.budget} onChange={setF("budget")} /></Field>
          <Field label="ขนาดที่ดินที่ต้องการ (ไร่)"><input type="number" className="kf-sans px-3 py-2 rounded" style={inputStyle()} value={form.sizeWanted} onChange={setF("sizeWanted")} /></Field>
          <Field label="เงื่อนไข/วัตถุประสงค์อื่นๆ"><input className="kf-sans px-3 py-2 rounded" style={inputStyle()} value={form.purpose} onChange={setF("purpose")} placeholder="เช่น ติดถนนใหญ่, ใกล้นิคมอุตสาหกรรม" /></Field>
        </div>
        <button onClick={run} disabled={running} className="kf-sans mt-4 px-4 py-2 rounded text-sm text-white flex items-center gap-1.5" style={{ background: C.ink, opacity: running ? 0.6 : 1 }}>
          {running ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
          {running ? "กำลังสรรหาและให้คะแนน..." : "ให้ AI สรรหาที่ดินน่าลงทุน"}
        </button>
        {running && progress && <div className="kf-sans text-xs mt-2" style={{ color: C.inkSoft }}>{progress}</div>}
      </div>

      {error && <div className="kf-sans text-sm mb-3" style={{ color: C.bad }}>{error}</div>}

      {results && (
        <>
          <div className="kf-sans text-xs mb-3" style={{ color: C.inkSoft }}>
            พบแปลงที่คะแนนถึงเกณฑ์ {results.length} แปลง (คัดออก {skipped} แปลงที่คะแนนไม่ถึง {INVEST_THRESHOLD.toFixed(1)})
          </div>
          {results.length === 0 && (
            <div className="kf-sans text-sm text-center py-8" style={{ color: C.inkSoft }}>
              ยังไม่พบแปลงที่คะแนนถึงเกณฑ์ {INVEST_THRESHOLD.toFixed(1)} จากการค้นหานี้ ลองปรับเกณฑ์หรือค้นหาใหม่อีกครั้ง
            </div>
          )}
          <div className="grid gap-3">
            {results.map((r, i) => (
              <RecommendedCard key={i} candidate={r.candidate} result={r.result} onSave={() => saveOne(r.candidate, r.result)} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function HistoryTab({ history, setHistory }) {
  const del = (id) => setHistory(history.filter((h) => h.id !== id));
  if (history.length === 0) {
    return <div className="kf-sans text-sm text-center py-10" style={{ color: C.inkSoft }}>ยังไม่มีประวัติการวิเคราะห์</div>;
  }
  return (
    <div className="kf-in grid gap-3">
      {history.map((h) => (
        <div key={h.id} className="rounded-lg p-4" style={{ background: C.panel, border: `1px solid ${C.line}` }}>
          <div className="flex justify-between items-center mb-2">
            <div className="kf-sans text-xs" style={{ color: C.inkSoft }}>{fmtDate(h.date)} · {h.source === "ai" ? "AI ค้นหาให้" : "นายหน้าเสนอ"}</div>
            <button onClick={() => del(h.id)} className="kf-sans text-xs flex items-center gap-1" style={{ color: C.bad }}><Trash2 size={12} /> ลบ</button>
          </div>
          <div className="kf-sans text-sm mb-2" style={{ color: C.ink }}>
            {[h.form.province, h.form.district].filter(Boolean).join(" / ") || "ไม่ระบุที่ตั้ง"} · {h.form.sizeRai || "-"} ไร่
          </div>
          <AnalysisResult result={h.result} sourceLabel={h.source === "ai" ? "AI ค้นหาให้" : "นายหน้าเสนอ"} onSaveHistory={() => {}} />
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------
   ROOT APP
--------------------------------------------------------- */
export default function App() {
  const [tab, setTab] = useState("portfolio");
  const [plots, setPlots] = useState([]);
  const [history, setHistory] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      let currentPlots = [];
      try {
        const r = await storage.get("khaifak_plots");
        currentPlots = r ? JSON.parse(r.value) : [];
      } catch { currentPlots = []; }
      try {
        const r2 = await storage.get("khaifak_analysis_history");
        setHistory(r2 ? JSON.parse(r2.value) : []);
      } catch { setHistory([]); }

      let seeded = true;
      try {
        await storage.get("khaifak_seed_farm_v1");
      } catch { seeded = false; }

      if (!seeded) {
        currentPlots = [
          ...currentPlots,
          {
            id: uid(),
            code: "ฟาร์มไก่ เพชรบูรณ์",
            province: "เพชรบูรณ์", district: "", subdistrict: "",
            sizeRai: "", sizeNgan: "", sizeWah: "", deedType: "โฉนดที่ดิน",
            appraisedValue: 10152000, contractAmount: 6500000, monthlyReturn: "1.25%",
            contractDate: "", dueDate: "", status: "active",
            notes: "นำเข้าจากไฟล์คำนวณขายฝากฟาร์มไก่ เพชรบูรณ์",
            costCalc: {
              marketValue: 17000000, interestRate: 0.0125, prepaidMonths: 2,
              depositFeeSelfPct: 0.02, brokerFeePct: 0.03, transferFeePct: 0.02,
              stampDuty: 28884, incomeTax: 442085, contractMonths: 12,
            },
          },
        ];
        storage.set("khaifak_seed_farm_v1", "1").catch(() => {});
      }
      setPlots(currentPlots);
      setLoaded(true);
    })();
  }, []);

  useEffect(() => {
    if (!loaded) return;
    storage.set("khaifak_plots", JSON.stringify(plots)).catch(() => {});
  }, [plots, loaded]);

  useEffect(() => {
    if (!loaded) return;
    storage.set("khaifak_analysis_history", JSON.stringify(history)).catch(() => {});
  }, [history, loaded]);

  const tabs = [
    { key: "portfolio", label: "แปลงในพอร์ต", icon: FileText },
    { key: "analysis", label: "วิเคราะห์ที่ดินใหม่", icon: Sparkles },
    { key: "recommend", label: "AI แนะนำที่ดิน", icon: Star },
    { key: "history", label: "ประวัติการวิเคราะห์", icon: Archive },
  ];

  return (
    <div className="min-h-screen kf-sans" style={{ background: C.paper, color: C.ink }}>
      <style>{FONT_CSS}</style>
      <div className="kf-texture py-6 px-5" style={{ borderBottom: `1px solid ${C.line}` }}>
        <div className="kf-serif text-2xl" style={{ color: C.ink }}>ระบบจัดการที่ดินขายฝาก</div>
        <div className="kf-sans text-sm mt-1" style={{ color: C.inkSoft }}>บันทึกแปลงในพอร์ต และวิเคราะห์ที่ดินก่อนตัดสินใจรับซื้อฝากด้วย AI</div>
      </div>

      <div className="max-w-3xl mx-auto px-4 pt-4">
        <div className="flex gap-1 mb-5 rounded-full p-1" style={{ background: C.panelDeep, width: "fit-content" }}>
          {tabs.map((t) => {
            const Icon = t.icon;
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className="kf-sans text-sm px-4 py-1.5 rounded-full flex items-center gap-1.5"
                style={active ? { background: C.ink, color: "#fff" } : { color: C.inkSoft }}
              >
                <Icon size={14} /> {t.label}
              </button>
            );
          })}
        </div>

        <div className="pb-16">
          {tab === "portfolio" && <PortfolioTab plots={plots} setPlots={setPlots} />}
          {tab === "analysis" && <AnalysisTab history={history} setHistory={setHistory} />}
          {tab === "recommend" && <RecommendedTab history={history} setHistory={setHistory} />}
          {tab === "history" && <HistoryTab history={history} setHistory={setHistory} />}
        </div>
      </div>
    </div>
  );
}
