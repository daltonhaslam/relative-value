// Share image: a 1200x630 PNG drawn on a canvas in the browser. Dollar amounts and names stay off it by default.
import { pctFmt } from "./charts.js";



export async function shareImage(st, res, { specName, locName, url }) {
  if (!res || !res.rows.length) return;
  await document.fonts.ready;
  const W = 1200, H = 630;
  const c = document.createElement("canvas");
  c.width = W * 2;
  c.height = H * 2;
  const g = c.getContext("2d");
  g.scale(2, 2);
  // Always the light "paper" palette: the image travels to feeds with their own themes.
  const paper = "#f7f8f4", ink = "#1c2330", ink2 = "#4a5263", bar = "#e3eedf", barInk = "#45614c";
  const cut = "#b01f2e", raise = "#1e4f9e";
  const tone = res.pct < -0.0005 ? cut : res.pct > 0.0005 ? raise : ink2;
  // tractor-feed paper: white sheet, green bars, sprocket holes, dashed perforations
  g.fillStyle = paper;
  g.fillRect(0, 0, W, H);
  g.fillStyle = "#ffffff";
  g.fillRect(24, 0, W - 48, H);
  g.fillStyle = bar;
  for (let y = 132; y < H; y += 96) g.fillRect(70, y, W - 140, 48);
  g.fillStyle = paper;
  for (let y = 18; y < H; y += 36) {
    g.beginPath(); g.arc(47, y, 8, 0, 7); g.fill();
    g.beginPath(); g.arc(W - 47, y, 8, 0, 7); g.fill();
  }
  g.strokeStyle = barInk;
  g.globalAlpha = 0.4;
  g.setLineDash([6, 5]);
  g.beginPath(); g.moveTo(70, 0); g.lineTo(70, H); g.moveTo(W - 70, 0); g.lineTo(W - 70, H); g.stroke();
  g.globalAlpha = 1;
  g.beginPath(); g.moveTo(70, 116); g.lineTo(W - 70, 116); g.stroke();
  g.setLineDash([]);

  g.fillStyle = barInk;
  g.font = "700 18px 'Courier Prime'";
  g.fillText("MEDICARE PHYSICIAN FEE SCHEDULE: SAME SERVICES, TWO PRICES", 92, 62);
  g.textAlign = "right";
  g.fillText("CY2026 → CY2027", W - 92, 62);
  g.textAlign = "left";
  g.fillStyle = ink;
  g.font = "700 22px 'Courier Prime'";
  const who = st.source === "npi" ? specName : (specName ? `Typical ${specName.toLowerCase()} practice` : "Custom practice");
  g.fillText(`${who}${locName && locName !== "National average" ? `, ${locName}` : ""}`.slice(0, 64), 92, 96);

  g.font = "800 180px Archivo";
  g.fillStyle = tone;
  g.fillText(pctFmt(res.pct), 86, 320);
  g.font = "500 28px Archivo";
  g.fillStyle = ink2;
  g.fillText("for the same services, 2027 rates vs 2026", 94, 372);

  // the three effects
  const fx = [["Conversion factor", res.effects.cf], ["Relative values and rules", res.effects.rvu], ["Geographic indices", res.effects.gpci]];
  let y = 444;
  g.font = "600 22px Archivo";
  for (const [name, v] of fx) {
    const p = res.totals.base ? v / res.totals.base : 0;
    g.fillStyle = ink2;
    g.fillText(name, 94, y);
    g.fillStyle = p < -0.0005 ? cut : p > 0.0005 ? raise : ink2;
    g.font = "700 22px 'Courier Prime'";
    g.fillText(pctFmt(p), 410, y);
    g.font = "600 22px Archivo";
    y += 36;
  }

  // stamp
  g.save();
  g.translate(W - 250, 470);
  g.rotate((-9 * Math.PI) / 180);
  g.strokeStyle = tone;
  g.fillStyle = tone;
  g.lineWidth = 6;
  g.globalAlpha = 0.9;
  g.strokeRect(-140, -58, 280, 116);
  g.font = "800 64px Archivo";
  g.textAlign = "center";
  g.fillText(res.pct < -0.0005 ? "CUT" : res.pct > 0.0005 ? "RAISE" : "FLAT", 0, 18);
  g.font = "600 18px Archivo";
  g.fillText("2027 vs 2026", 0, 46);
  g.restore();

  g.fillStyle = ink;
  g.font = "700 24px Archivo";
  g.textAlign = "right";
  g.fillText("Relative Value", W - 92, 200);
  g.font = "500 20px Archivo";
  g.fillStyle = ink2;
  g.fillText(url.replace(/^https?:\/\//, ""), W - 92, 228);
  g.textAlign = "left";

  const blob = await new Promise((r) => c.toBlob(r, "image/png"));
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "relative-value-2027.png";
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

