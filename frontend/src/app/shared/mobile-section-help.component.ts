import { Component, Input, ViewEncapsulation } from '@angular/core';
@Component({
 selector:'app-mobile-section-help',standalone:true,encapsulation:ViewEncapsulation.None,
 template:`<div class="pt-section-help"><button type="button" class="pt-section-help-trigger" (click)="open=!open" [attr.aria-expanded]="open" [attr.aria-controls]="helpId" [attr.aria-label]="'Explain ' + heading">Explain more <span class="pt-section-help-chevron" [class.open]="open" aria-hidden="true"></span></button><div class="pt-section-help-expand" [class.open]="open" [attr.inert]="open?null:''" [attr.aria-hidden]="!open"><div class="pt-section-help-inner"><div class="pt-section-help-answer" [id]="helpId" role="region" [attr.aria-label]="heading"><header><strong>{{heading}}</strong><button type="button" class="pt-section-help-close" (click)="open=false" aria-label="Close explanation">Close ×</button></header><div class="pt-section-help-body"><ng-content></ng-content></div></div></div></div></div>`,
 styles:[`
 app-mobile-section-help{display:none}
 @media(max-width:767.98px){
  app-mobile-section-help{display:block;margin:0 0 8px;min-width:0}
  app-mobile-section-help .pt-section-help{text-align:right}
  app-mobile-section-help .pt-section-help-trigger{display:inline-flex;align-items:center;justify-content:flex-end;gap:5px;min-height:40px;padding:0;border:0;border-radius:4px;background:transparent;color:#aeb4c0;font:500 14px/21px var(--font-family,-apple-system,BlinkMacSystemFont,Inter,'Segoe UI',Roboto,sans-serif);text-decoration:none;cursor:pointer}
  app-mobile-section-help .pt-section-help-chevron{width:6px;height:6px;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:translateY(-2px) rotate(45deg);transition:transform .2s;flex:none}
  app-mobile-section-help .pt-section-help-chevron.open{transform:translateY(2px) rotate(225deg)}
  app-mobile-section-help .pt-section-help-expand{display:grid;grid-template-rows:0fr;transition:grid-template-rows .28s ease;text-align:left}
  app-mobile-section-help .pt-section-help-expand.open{grid-template-rows:1fr}
  app-mobile-section-help .pt-section-help-inner{overflow:hidden;min-height:0}
  app-mobile-section-help .pt-section-help-answer{padding:12px;border-radius:12px;background:rgba(0,0,0,.32);box-shadow:inset 0 0 0 1px rgba(255,255,255,.08);margin-bottom:4px}
  app-mobile-section-help header{display:flex;justify-content:space-between;align-items:baseline;gap:12px}
  app-mobile-section-help header strong{font-size:16px;font-weight:600;line-height:24px;color:#f4f5f7}
  app-mobile-section-help .pt-section-help-close{font-family:inherit;font-size:14px;font-weight:500;line-height:21px;color:#aeb4c0;background:transparent;border:0;padding:0;min-height:40px;margin:-8px 0;white-space:nowrap}
  app-mobile-section-help .pt-section-help-body p{font-size:16px;font-weight:400;line-height:24px;color:#d4d8e0;margin:8px 0 0}
  app-mobile-section-help .pt-section-help-body a{color:#86c5ea}
  app-mobile-section-help button:focus-visible{outline:2px solid #d5a04c;outline-offset:2px}
 }
 @media(prefers-reduced-motion:reduce){app-mobile-section-help .pt-section-help-expand,app-mobile-section-help .pt-section-help-chevron{transition:none}}
 `]
})
export class MobileSectionHelpComponent {
 @Input() helpId='';
 @Input() heading='About this section';
 open=false;
}
