import type { FormDesign } from "../shared/form-schema";

const SHADOWS: Record<FormDesign["shadow"], string> = {
  none: "none",
  sm: "0 1px 3px rgba(0,0,0,.08)",
  md: "0 4px 14px rgba(0,0,0,.10)",
  lg: "0 12px 32px rgba(0,0,0,.16)",
};

/** Feuille de style du formulaire (Shadow DOM : isolée du thème). */
export function formCss(d: FormDesign): string {
  return `
:host{all:initial;display:block;--kb-text:${d.textColor};--kb-label:${d.labelColor};--kb-bg:${d.background};--kb-border:${d.borderColor};
--kb-radius:${d.borderRadius}px;--kb-pad:${d.padding}px;--kb-gap:${d.spacing}px;--kb-field-bg:${d.fieldBackground};--kb-field-text:${d.fieldTextColor};
--kb-field-border:${d.fieldBorderColor};--kb-field-bw:${d.fieldBorderWidth}px;--kb-field-radius:${d.fieldRadius}px;--kb-field-h:${d.fieldHeight}px;
--kb-focus:${d.focusColor};--kb-icon:${d.iconColor};--kb-error:${d.errorColor};--kb-accent:${d.accentColor};--kb-btn-bg:${d.buttonBackground};
--kb-btn-text:${d.buttonTextColor};--kb-btn-radius:${d.buttonRadius}px;--kb-btn-size:${d.buttonFontSize}px;--kb-btn-h:${d.buttonHeight}px;
--kb-btn-border:${d.buttonBorderColor};--kb-btn-bw:${d.buttonBorderWidth}px;--kb-overlay:${d.overlayColor};
font-family:${d.fontFamily === "inherit" ? "inherit" : d.fontFamily};font-size:${d.fontSize}px;color:var(--kb-text);line-height:1.4}
*{box-sizing:border-box;font-family:inherit}
.kb-form{background:var(--kb-bg);border:${d.borderWidth}px solid var(--kb-border);border-radius:var(--kb-radius);padding:var(--kb-pad);
box-shadow:${SHADOWS[d.shadow]};max-width:${d.maxWidth}px;margin:0 auto;display:grid;grid-template-columns:1fr 1fr;gap:var(--kb-gap)}
.kb-form>*{grid-column:1/-1;min-width:0}.kb-form>.kb-half{grid-column:span 1}
@media (max-width:480px){.kb-form>.kb-half{grid-column:1/-1}}
.kb-tpl-minimal .kb-form{border:none;box-shadow:none;padding:0}
.kb-tpl-bold .kb-label{text-transform:uppercase;letter-spacing:.04em;font-size:.85em}
.kb-tpl-classic .kb-input{border-radius:2px}
.kb-label{display:block;margin:0 0 4px;color:var(--kb-label);font-weight:${d.labelBold ? 600 : 400};font-style:${d.labelItalic ? "italic" : "normal"}}
.kb-req{color:var(--kb-error)}
.kb-control{position:relative;display:flex;align-items:center}
.kb-icon{position:absolute;inset-inline-start:12px;width:18px;height:18px;color:var(--kb-icon);pointer-events:none}
.kb-input{width:100%;min-height:var(--kb-field-h);padding:8px 12px;background:var(--kb-field-bg);color:var(--kb-field-text);
border:var(--kb-field-bw) solid var(--kb-field-border);border-radius:var(--kb-field-radius);font-size:max(16px,1em);outline:none;transition:border-color .15s,box-shadow .15s}
.kb-has-icon .kb-input{padding-inline-start:38px}
textarea.kb-input{min-height:84px;resize:vertical}
.kb-input:focus{border-color:var(--kb-focus);box-shadow:0 0 0 3px color-mix(in srgb,var(--kb-focus) 20%,transparent)}
.kb-invalid .kb-input{border-color:var(--kb-error)}
.kb-err{color:var(--kb-error);font-size:.85em;margin-top:4px;min-height:0}
.kb-choices{display:flex;flex-direction:column;gap:6px}
.kb-choice{display:flex;align-items:center;gap:8px;cursor:pointer}
.kb-choice input{width:18px;height:18px;accent-color:var(--kb-accent);margin:0}
.kb-heading{margin:0;font-weight:700}
.kb-text{white-space:pre-wrap;margin:0}
.kb-img{display:block;margin:0 auto;max-width:100%;height:auto;border-radius:8px}
.kb-divider{border:none;border-top:1px solid var(--kb-border);margin:0}
.kb-countdown{display:flex;justify-content:center;align-items:center;gap:8px;padding:10px;border-radius:8px;background:#fef2f2;color:#b91c1c;font-weight:600}
.kb-countdown b{font-variant-numeric:tabular-nums;font-size:1.15em}
.kb-cart{display:flex;gap:12px;align-items:center;padding:10px;border:1px solid var(--kb-border);border-radius:10px}
.kb-cart img{width:64px;height:64px;object-fit:cover;border-radius:8px;flex:none}
.kb-cart-info{flex:1;min-width:0;display:flex;flex-direction:column;gap:6px}
.kb-cart-title{font-weight:600;overflow:hidden;text-overflow:ellipsis}
.kb-price{font-weight:700;white-space:nowrap}.kb-compare{white-space:nowrap;text-decoration:line-through;opacity:.6;margin-inline-start:6px;font-weight:400}
.kb-qty{display:inline-flex;align-items:center;border:1px solid var(--kb-field-border);border-radius:8px;overflow:hidden}
.kb-qty button{width:34px;height:34px;border:none;background:transparent;font-size:18px;cursor:pointer;color:inherit}
.kb-qty span{min-width:32px;text-align:center;font-weight:600}
.kb-select{min-height:36px;padding:4px 8px;border:1px solid var(--kb-field-border);border-radius:8px;background:var(--kb-field-bg);color:var(--kb-field-text);font-size:max(16px,1em)}
.kb-offers{display:flex;flex-direction:column;gap:8px}.kb-offers.kb-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr))}
.kb-section-title{font-weight:600;margin:0 0 6px}
.kb-tier{position:relative;display:flex;align-items:center;gap:10px;padding:12px;border:2px solid var(--kb-border);border-radius:10px;cursor:pointer;background:var(--kb-field-bg)}
.kb-tier.kb-on{border-color:var(--kb-tier-accent,var(--kb-accent));background:color-mix(in srgb,var(--kb-tier-accent,var(--kb-accent)) 7%,var(--kb-field-bg))}
.kb-tier input{accent-color:var(--kb-tier-accent,var(--kb-accent));width:18px;height:18px;margin:0}
.kb-tier img{width:44px;height:44px;object-fit:cover;border-radius:6px}
.kb-tier-main{flex:1;display:flex;flex-direction:column}.kb-tier-sub{font-size:.85em;opacity:.75}
.kb-badge{position:absolute;top:-10px;inset-inline-end:10px;background:var(--kb-tier-accent,var(--kb-accent));color:#fff;font-size:.75em;font-weight:700;padding:2px 8px;border-radius:99px}
.kb-upsell{display:flex;gap:10px;align-items:center;padding:10px;border:2px dashed var(--kb-accent);border-radius:10px;cursor:pointer}
.kb-upsell img{width:48px;height:48px;object-fit:cover;border-radius:6px}
.kb-summary{border-top:1px solid var(--kb-border);padding-top:8px;display:flex;flex-direction:column;gap:4px}
.kb-row{display:flex;justify-content:space-between;gap:8px}.kb-row.kb-total{font-weight:700;font-size:1.1em}.kb-row.kb-disc{color:#15803d}
.kb-discount{display:flex;gap:8px}.kb-discount .kb-input{flex:1}
.kb-btn{position:relative;width:100%;min-height:var(--kb-btn-h);border:var(--kb-btn-bw) solid var(--kb-btn-border);border-radius:var(--kb-btn-radius);
background:var(--kb-btn-bg);color:var(--kb-btn-text);font-size:var(--kb-btn-size);font-weight:${d.buttonBold ? 700 : 500};cursor:pointer;padding:8px 16px;
display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;transition:transform .1s,opacity .15s}
.kb-btn:active{transform:scale(.99)}.kb-btn[disabled]{opacity:.6;cursor:not-allowed}
.kb-btn small{font-size:.72em;font-weight:400;opacity:.9}
.kb-btn-sec{background:transparent;color:var(--kb-text);border:1px solid var(--kb-border);min-height:40px;font-size:1em;font-weight:500}
.kb-anim-pulse{animation:kbPulse 2s infinite}.kb-anim-shake{animation:kbShake 3s infinite}.kb-anim-bounce{animation:kbBounce 2s infinite}
.kb-anim-glow{animation:kbGlow 2s infinite}
@keyframes kbPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.025)}}
@keyframes kbShake{0%,86%,100%{transform:translateX(0)}88%,92%,96%{transform:translateX(-4px)}90%,94%,98%{transform:translateX(4px)}}
@keyframes kbBounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
@keyframes kbGlow{0%,100%{box-shadow:0 0 0 0 color-mix(in srgb,var(--kb-btn-bg) 50%,transparent)}50%{box-shadow:0 0 0 8px transparent}}
@media (prefers-reduced-motion:reduce){[class*=kb-anim-]{animation:none}}
.kb-alert{padding:10px 12px;border-radius:8px;background:#fef2f2;color:var(--kb-error);border:1px solid color-mix(in srgb,var(--kb-error) 30%,transparent)}
.kb-success{text-align:center;padding:24px 8px}.kb-success h3{margin:8px 0}.kb-success svg{width:56px;height:56px;color:#16a34a}
.kb-otp{display:flex;flex-direction:column;gap:10px;text-align:center}
.kb-otp .kb-input{text-align:center;letter-spacing:.5em;font-size:22px}
.kb-hp{position:absolute!important;left:-10000px!important;width:1px;height:1px;overflow:hidden}
.kb-overlay{position:fixed;inset:0;z-index:2147483000;background:var(--kb-overlay);display:flex;align-items:flex-end;justify-content:center;padding:0;animation:kbFade .2s}
@media (min-width:640px){.kb-overlay{align-items:center;padding:24px}}
.kb-preview-popup .kb-overlay{position:relative;inset:auto;padding:12px;align-items:flex-start;border-radius:12px}
.kb-preview-popup .kb-modal{max-height:none}
.kb-modal{position:relative;width:100%;max-width:${Math.max(d.maxWidth, 360)}px;max-height:92vh;overflow:auto;background:var(--kb-bg);border-radius:var(--kb-radius) var(--kb-radius) 0 0;animation:kbUp .25s}
@media (min-width:640px){.kb-modal{border-radius:var(--kb-radius)}}
.kb-modal .kb-form{border:none;box-shadow:none;max-width:none}
.kb-close{position:sticky;top:0;float:inline-end;margin:6px;width:36px;height:36px;border:none;border-radius:50%;background:rgba(0,0,0,.06);cursor:pointer;font-size:20px;line-height:1;color:inherit;z-index:2}
@keyframes kbFade{from{opacity:0}}@keyframes kbUp{from{transform:translateY(30px);opacity:0}}
.kb-sticky{position:fixed;inset-inline:0;bottom:0;z-index:2147482000;padding:10px 12px calc(10px + env(safe-area-inset-bottom));background:rgba(255,255,255,.96);box-shadow:0 -4px 16px rgba(0,0,0,.1)}
.kb-sticky.kb-top{top:0;bottom:auto}
@media (min-width:768px){.kb-sticky.kb-mobile-only{display:none}}
.kb-preview-popup .kb-sticky{position:absolute}
.kb-downsell{text-align:center;padding:24px;display:flex;flex-direction:column;gap:12px}
.kb-spinner{width:18px;height:18px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:kbSpin .7s linear infinite;display:inline-block}
@keyframes kbSpin{to{transform:rotate(360deg)}}
`;
}
