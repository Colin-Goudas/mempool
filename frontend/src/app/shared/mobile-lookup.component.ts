import { Component } from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import { getRegex } from '@app/shared/regex.utils';
@Component({selector:'app-mobile-lookup',standalone:true,imports:[RouterModule],template:`
<form (submit)="$event.preventDefault(); lookup(query.value)" aria-label="Find a Bitcoin transaction or address">
<label for="mobile-direct-lookup">Transaction ID or Bitcoin address</label>
<div class="lookup-field"><input #query id="mobile-direct-lookup" type="search" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Paste a transaction ID or address" aria-describedby="mobile-lookup-feedback"><button type="submit">Search →</button></div>
<p id="mobile-lookup-feedback" role="status">{{ feedback }}</p>
</form><nav aria-label="Try an example"><span>Try an example:</span><a routerLink="/tx/c5908e04daea83ec38101692a0663130bcafa7d0ddaef1fd8821d179d1db1c8c">Transaction</a><a routerLink="/address/1J5VmAoXLfwsT4h18hJTLtFejsVV7gTSAK">Address</a></nav>`,styles:[`
:host{display:none}@media(max-width:767.98px){:host{display:block;width:100%;text-align:left}label{display:block;font-size:14px;font-weight:500;color:#c6cad2;margin-bottom:8px}.lookup-field{display:flex;flex-wrap:wrap;gap:8px}input{flex:1 1 100%;min-width:0;width:100%;height:48px;border:1px solid #ffffff30;border-radius:10px;background:#ffffff06;color:#f4f5f7;font:inherit;font-size:16px;padding:0 12px}button{width:100%;min-height:44px;border:1px solid #d5a04c77;border-radius:10px;background:#d5a04c14;color:#f4f5f7;font:inherit;font-size:14px;font-weight:600}p{font-size:14px;line-height:21px;color:#c6cad2;margin:6px 0}p:empty{display:none}nav{display:flex;gap:12px;flex-wrap:wrap;margin-top:14px;font-size:14px;line-height:21px;color:#aeb4c0}a{color:#86c5ea;min-height:40px;display:inline-flex;align-items:center}nav span{display:inline-flex;align-items:center}input:focus-visible,button:focus-visible,a:focus-visible{outline:2px solid #d5a04c;outline-offset:2px}}
`]})
export class MobileLookupComponent {
 feedback='';
 constructor(private router:Router){}
 lookup(raw:string):void {
  const value=raw.trim().replace(/^bitcoin:/i,'').split('?')[0];
  if(getRegex('transaction').test(value)){void this.router.navigate(['/tx',value]);return;}
  if(getRegex('address','mainnet').test(value)){void this.router.navigate(['/address',value]);return;}
  this.feedback='Enter a complete Bitcoin transaction ID or mainnet address.';
 }
}
