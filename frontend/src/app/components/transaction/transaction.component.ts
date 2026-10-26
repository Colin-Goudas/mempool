import { faBell } from '@fortawesome/free-solid-svg-icons';
import { transactionNextStep, replacementHistoryCount } from './transaction-guidance';
import { transactionSnapshot, transactionSummary, transactionTechnicalFacts } from './transaction-snapshot';
import { Component, OnInit, AfterViewInit, OnDestroy, HostListener, ViewChild, ElementRef, Inject, ChangeDetectorRef } from '@angular/core';
import { ElectrsApiService } from '@app/services/electrs-api.service';
import { ActivatedRoute, ParamMap, Router } from '@angular/router';
import { TransactionsListComponent } from '@components/transactions-list/transactions-list.component';
import {
  switchMap,
  filter,
  catchError,
  retryWhen,
  delay,
  mergeMap,
  tap,
  map,
  retry,
  startWith,
  repeat,
  take,
  distinctUntilChanged
} from 'rxjs/operators';
import { Transaction } from '@interfaces/electrs.interface';
import { of, merge, Subscription, Observable, Subject, from, throwError, combineLatest, BehaviorSubject, timer } from 'rxjs';
import { StateService } from '@app/services/state.service';
import { CacheService } from '@app/services/cache.service';
import { WebsocketService } from '@app/services/websocket.service';
import { AudioService } from '@app/services/audio.service';
import { ApiService } from '@app/services/api.service';
import { SeoService } from '@app/services/seo.service';
import { StorageService } from '@app/services/storage.service';
import { seoDescriptionNetwork } from '@app/shared/common.utils';
import { getTransactionFlags, getUnacceleratedFeeRate } from '@app/shared/transaction.utils';
import { Filter, TransactionFlags, toFilters } from '@app/shared/filters.utils';
import { BlockExtended, CpfpInfo, RbfTree, MempoolPosition, DifficultyAdjustment, Acceleration, AccelerationPosition } from '@interfaces/node-api.interface';
import { LiquidUnblinding } from '@components/transaction/liquid-ublinding';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';
import { PriceService } from '@app/services/price.service';
import { isFeatureActive } from '@app/bitcoin.utils';
import { ServicesApiServices } from '@app/services/services-api.service';
import { PartnerCodeService } from '@app/services/partner-code.service';
import { ZONE_SERVICE } from '@app/injection-tokens';
import { MiningService, MiningStats } from '@app/services/mining.service';
import { ETA, EtaService } from '@app/services/eta.service';

export interface Pool {
  id: number;
  name: string;
  slug: string;
  minerName?: string;
  minerSlug?: string;
  minerNames: string[] | null;
}

export interface TxAuditStatus {
  seen?: boolean;
  expected?: boolean;
  added?: boolean;
  prioritized?: boolean;
  delayed?: number;
  accelerated?: boolean;
  conflict?: boolean;
  coinbase?: boolean;
  firstSeen?: number;
}

// Known duplicate transaction IDs from early Bitcoin history (pre-BIP-30)
const DUPLICATE_TX_BLOCKS: Record<string, [number, number]> = {
  'e3bf3d07d4b0375638d5f1db5255fe07ba2c4cb067cd81b84ee974b6585fb468': [91722, 91880],
  'd5d27987d2a3dfc724e359870c6644b40e497bdc0589a033220fe15429d88599': [91812, 91842],
};

@Component({
  selector: 'app-transaction',
  templateUrl: './transaction.component.html',
  styleUrls: ['./transaction.component.scss'],
  standalone: false,
})
export class TransactionComponent implements OnInit, AfterViewInit, OnDestroy {
  readonly confirmationBellIcon = faBell;
  get pendingTrackerSnapshot() { return this.network === '' && !!this.stateService.env.PENDING_TRACKER_EXPLANATIONS; }
  activeSummaryQuestion = '';
  onSummaryToggle(id: string, event: Event): void {
    if ((event as Event & {newState: string}).newState === 'open') this.activeSummaryQuestion = id;
    else if (this.activeSummaryQuestion === id) this.activeSummaryQuestion = '';
  }
  showReplacementDiagram = false;
  get replacementCount(): number { return replacementHistoryCount(this.rbfInfo); }
  revealReplacementDiagram(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    const answer = (event.currentTarget as HTMLElement)?.closest('[popover]') as HTMLElement & {hidePopover?: () => void};
    answer?.hidePopover?.();
    this.showReplacementDiagram = true;
    this.cd.detectChanges();
  }
  showUsd = true;
  selectedAddress = '';
  addressFeedback = '';
  helpRole = '';
  fastFeeRate?: number;
  feeUpdatedAt = '';
  estimateChanged = false;
  private previousEta?: {txid: string; blocks: number};
  alertTxid = '';
  alertMessage = '';
  selectedAlertTarget = 0;
  activeAlertTarget = 1;
  alertRequestPending = false;
  get addressMatches() { return this.selectedAddress ? [this.selectedAddress] : []; }
  get matchedInputIndex() { const i = this.tx?.vin?.findIndex(v => v.prevout?.scriptpubkey_address === this.selectedAddress); return this.selectedAddress && i >= 0 ? i : this.inputIndex; }
  get matchedOutputIndex() { const i = this.tx?.vout?.findIndex(v => v.scriptpubkey_address === this.selectedAddress); return this.selectedAddress && i >= 0 ? i : this.outputIndex; }
  get selectedOutputSats() { return this.selectedAddress ? this.tx?.vout?.filter(v => v.scriptpubkey_address === this.selectedAddress).reduce((sum,v) => sum + v.value, 0) || 0 : 0; }
  get totalOutputSats() { return this.tx?.vout?.reduce((sum,v) => sum + v.value, 0) || 0; }
  get displayAmountSats() { return this.selectedAddress ? this.selectedOutputSats : this.totalOutputSats; }
  get ownFeeRate() { return this.tx?.weight > 0 ? this.tx.fee / (this.tx.weight / 4) : undefined; }
  get feeInterpretation() {
    if (this.tx?.status?.confirmed) return 'Confirmed on Bitcoin. No fee increase is needed.';
    if (!this.tx?.status?.confirmed && (this.replaced || this.rbfTransaction)) return 'A replacement was observed. Follow its current status above.';
    if (!this.fastFeeRate || this.ownFeeRate === undefined) return 'Waiting for confirmation. A reliable fee comparison is currently unavailable.';
    return this.ownFeeRate < this.fastFeeRate ? 'Your rate is below the first projected block’s median rate. Waiting remains an option; check fee-increase options if timing matters.' : 'Your rate meets or exceeds the first projected block’s median rate. Waiting is reasonable; inclusion is not guaranteed.';
  }
  findTransactionAddress(value: string): void {
    const address = value.trim();
    const normalized = /^bc1/i.test(address) ? address.toLowerCase() : address;
    const found = this.tx?.vin?.some(v => v.prevout?.scriptpubkey_address === normalized) || this.tx?.vout?.some(v => v.scriptpubkey_address === normalized);
    this.selectedAddress = found ? normalized : '';
    this.addressFeedback = found ? 'Matching rows are highlighted. The diagram selects the first matching input/output; combined strands may group others.' : 'No matching address in this transaction. Check the full address and Bitcoin network.';
  }
  phoneLayout = window.innerWidth <= 767.98;

  get confirmationCount(): number {
    if (!this.tx?.status?.confirmed) return 0;
    const height = this.tx.status.block_height;
    return Number.isFinite(height) && Number.isFinite(this.latestBlock?.height) ? Math.max(1, this.latestBlock.height - height + 1) : 1;
  }
  get confirmationTarget(): number { return this.selectedAlertTarget || (this.tx?.status?.confirmed ? 6 : 1); }
  get confirmationAlertLabel(): string {
    if (this.alertTxid === this.tx?.txid) return 'Alert set: ' + this.confirmationCount + ' of ' + this.activeAlertTarget;
    if (!this.tx?.status?.confirmed) return 'Notify when confirmed';
    return this.confirmationCount >= this.confirmationTarget ? 'Track confirmations' : 'Notify at ' + this.confirmationTarget + ' confirmations';
  }
  cancelConfirmationAlert(): void { this.alertTxid = ''; this.alertMessage = 'Confirmation alert turned off.'; }
  async enableConfirmationAlert(): Promise<void> {
    const txid = this.tx?.txid;
    const target = this.confirmationTarget;
    if (!txid || this.alertRequestPending) return;
    if (this.confirmationCount >= target) { this.alertMessage = 'This target has already been reached. Choose a higher target to set an alert.'; return; }
    if (typeof window === 'undefined' || !('Notification' in window)) { this.alertMessage = 'Desktop alerts are not supported in this browser. Keep this page open to track confirmations.'; return; }
    this.alertRequestPending = true;
    try {
      const permission = await Notification.requestPermission();
      if (this.tx?.txid !== txid) return;
      if (permission === 'granted') {
        this.alertTxid = txid; this.activeAlertTarget = target;
        this.alertMessage = 'Alert set for ' + target + (target === 1 ? ' confirmation' : ' confirmations') + ' while this page stays open and connected.';
        this.checkConfirmationAlert();
      } else this.alertMessage = 'Desktop alert permission was not granted. You can continue tracking here.';
    } catch { if (this.tx?.txid === txid) this.alertMessage = 'The browser could not enable desktop alerts. You can continue tracking here.'; }
    finally { this.alertRequestPending = false; }
  }
  private checkConfirmationAlert(): void {
    if (!this.tx || this.alertTxid !== this.tx.txid || this.confirmationCount < this.activeAlertTarget) return;
    const target = this.activeAlertTarget;
    this.alertTxid = '';
    this.alertMessage = 'Your tracking target of ' + target + (target === 1 ? ' confirmation has' : ' confirmations has') + ' been reached.';
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try { new Notification('Bitcoin confirmation target reached', {body:'Your tracked transaction has reached ' + target + (target === 1 ? ' confirmation.' : ' confirmations.'), tag:this.tx.txid}); }
      catch { this.alertMessage += ' Desktop delivery was unavailable; the target is shown here.'; }
    }
  }
  summaryStatus(): string {
    if (!this.tx?.status?.confirmed && (this.replaced || this.rbfTransaction)) return 'A replacement was observed for this transaction.';
    if (this.rbfInfo?.mined && !this.tx?.status?.confirmed) return 'A conflicting transaction has confirmed.';
    if (this.tx?.vin?.some(v => v.is_coinbase)) return 'This is a Bitcoin mining reward transaction.';
    if (!this.tx?.status?.confirmed) return 'This Bitcoin transaction is waiting for its first confirmation.';
    return 'This transaction is confirmed on Bitcoin.';
  }
  nextStep(connected: boolean): string {
    return transactionNextStep({confirmed:!!this.tx?.status?.confirmed, confirmations:this.confirmationCount,
      coinbase:!!this.tx?.vin?.some(v=>v.is_coinbase), replaced:!!(this.replaced || this.rbfTransaction),
      conflict:!!this.rbfInfo?.mined && !this.tx?.status?.confirmed, cached:!!this.isCached,
      connected});
  }
  summaryExpanded = false;
  summaryContext(eta: ETA | null, detailOnly = false): string {
    if (!this.tx) return '';
    if (!this.tx.status.confirmed && (this.replaced || this.rbfTransaction || this.rbfInfo?.mined)) return 'Review the status notice and linked transaction above before relying on this record.';
    if (this.tx.vin?.some(v => v.is_coinbase)) return 'It creates the block subsidy and collects transaction fees; it does not pay a normal network fee.';
    const fee = this.tx.fee.toLocaleString('en-US') + (this.tx.fee === 1 ? ' sat' : ' sats');
    const rate = this.ownFeeRate?.toLocaleString('en-US', {maximumFractionDigits:2});
    const timing = detailOnly || this.tx.status.confirmed ? '' : eta && Number.isFinite(eta.wait) && eta.wait >= 0 ? 'The current estimate is about ' + Math.max(1, Math.ceil(eta.wait / 60000)) + ' minutes, but it can change. ' : 'A reliable confirmation-time estimate is currently unavailable. ';
    return timing + (this.tx.status.confirmed ? 'It paid ' : 'It pays ') + fee + ' in network fees' + (this.tx.status.confirmed ? '.' : ' at ' + rate + ' sat/vB.');
  }
  summaryPreviewContext(eta: ETA | null): string {
    if (!this.tx) return '';
    if (this.tx.status.confirmed || this.tx.vin?.some(v => v.is_coinbase) || this.replaced || this.rbfTransaction || this.rbfInfo?.mined) return this.summaryContext(eta);
    return eta && Number.isFinite(eta.wait) && eta.wait >= 0
      ? 'The current estimate is about ' + Math.max(1, Math.ceil(eta.wait / 60000)) + ' minutes, but it can change.'
      : 'A reliable confirmation-time estimate is currently unavailable.';
  }
  summaryExtraContext(eta: ETA | null): string {
    if (!this.tx || this.tx.status.confirmed || this.tx.vin?.some(v => v.is_coinbase) || this.replaced || this.rbfTransaction || this.rbfInfo?.mined) return '';
    return this.summaryContext(eta, true);
  }
  mobileDetailMeaning(label: string, fallback: string): string {
    return ({
      'Size':'Actual transaction data size.',
      'Virtual size':'Block space used after the witness discount.',
      'Adjusted vsize':'Virtual size used for fee comparisons.',
      'Weight':'This transaction’s share of block capacity.',
      'Version':'The transaction’s protocol format.',
      'Locktime':'A height or time condition on inclusion.',
      'Sigops':'Signature checks needed to validate it.',
      'Transaction hex':'The complete raw transaction data.',
      'Miner attribution':'Pool attributed to the containing block.',
      'Observed confirmation duration':'Provider-observed wait before confirmation.',
      'Fee replacement':'Whether a fee replacement was observed.',
      'Transaction features':'Observed witness and replacement features.',
      'Transaction tags':'Tags describe the transaction’s structure.',
      'Block audit':'How the mined block matched predictions.'
    } as Record<string,string>)[label] || fallback;
  }
  mobileSnapshotLabel(label: string): string {
    return ({'Estimated confirmation':'ETA','Confirmed at':'Confirmed','Included in block':'Block','Miner attribution':'Miner','Observed confirmation duration':'Observed wait','Effective fee rate':'Effective rate','Replacement history':'Replacements'} as Record<string,string>)[label] || label;
  }
  mobileSnapshotValue(label: string, value: string, secondary?: string): string {
    if ((label === 'First seen' || label === 'Confirmed at') && secondary) return secondary.replace('Less than a minute ago', 'Just now').replace(/minutes?/g, 'min').replace(/hours?/g, 'hr');
    if (label === 'Estimated confirmation') return value.replace(/^About /, '~').replace(/ minutes?/g, ' min').replace(/ hours?/g, ' hr');
    if (label === 'Observed confirmation duration') return '~' + value.replace(/ minutes?/g, ' min').replace(/ hours?/g, ' hr');
    if (label === 'Replacement history') return value.replace(/ replacements?$/, '');
    return value;
  }
  private mobilePopoverAutoScroll = false;
  positionMobilePopover(event: Event): void {
    if (window.innerWidth > 767.98 || (event as Event & {newState?: string}).newState !== 'open') return;
    const panel = event.target as HTMLElement;
    const trigger = Array.from(document.querySelectorAll<HTMLButtonElement>('#pt-transaction-layout button[popovertarget]'))
      .find(button => button.getAttribute('popovertarget') === panel.id && button.getAttribute('popovertargetaction') !== 'hide');
    if (!trigger) return;
    panel.classList.add('pt-anchored-mobile-popover');
    const viewportHeight = window.visualViewport?.height || window.innerHeight;
    if (viewportHeight - trigger.getBoundingClientRect().bottom - 84 < 140) {
      this.mobilePopoverAutoScroll = true;
      trigger.scrollIntoView({block:'center', behavior:'auto'});
    }
    requestAnimationFrame(() => {
      this.mobilePopoverAutoScroll = false;
      if (!panel.matches(':popover-open')) return;
      const rect = trigger.getBoundingClientRect();
      const anchor = trigger.closest('.pt-metric-card, .pt-summary-actionbar')?.getBoundingClientRect() || rect;
      const viewportWidth = document.documentElement.clientWidth;
      const width = Math.min(Math.max(anchor.width, 260), viewportWidth - 24);
      const left = Math.max(12, Math.min(anchor.left, viewportWidth - width - 12));
      const top = Math.max(8, rect.bottom + 6);
      panel.style.setProperty('--pt-popover-top', top + 'px');
      panel.style.setProperty('--pt-popover-left', left + 'px');
      panel.style.setProperty('--pt-popover-width', width + 'px');
      panel.style.setProperty('--pt-popover-height', Math.max(80, Math.min(420, viewportHeight - top - 76)) + 'px');
    });
  }
  @HostListener('window:scroll')
  closeMobileExplanationsOnPageScroll(): void {
    if (window.innerWidth > 767.98 || this.mobilePopoverAutoScroll) return;
    document.querySelectorAll<HTMLElement>('#pt-transaction-layout .pt-anchored-mobile-popover:popover-open').forEach(panel =>
      (panel as HTMLElement & {hidePopover?: () => void}).hidePopover?.());
  }
  mobileQuestionLabel(id: string): string {
    return ({pending:'Why pending?', time:'Timing', speed:'Speed up', lost:'Funds safe?', missing:'Missing funds?', amount:'My amount?', confirmations:'Confirmations', fee:'Fee'} as Record<string, string>)[id] || id;
  }
  get summaryQuestions() {
    if (this.tx?.status?.confirmed) return [
      {id:'missing', label:'Funds not showing?', text:'A confirmed transaction is recorded on Bitcoin, but the receiving service may still be processing the deposit. Check the receiving address, supported network and its confirmation requirements. If those match, contact the receiving service through official support. We cannot see its internal account status.'},
      {id:'amount', label:'Which amount is mine?', text:'A Bitcoin transaction can pay several addresses and return change to the sender. The total output is not necessarily your payment. Use Find an address in this transaction below to highlight an address and total its matching outputs. Selecting an address does not establish ownership. Fiat values use the current price.'},
      {id:'confirmations', label:'What do confirmations mean?', text:'The containing block is the first confirmation. Each later block adds another, making a reversal through a chain reorganization progressively less likely. The transaction is already confirmed at one confirmation. Six is a common example tracking target, not a universal requirement: receiving platforms may require fewer or more confirmations before crediting a deposit. Confirmation does not prove the recipient is correct or a payment is legitimate.'},
      {id:'fee', label:'Why this fee?', text:'The network fee pays miners for including this transaction. Wallets normally choose a fee rate based on transaction size and current demand. This transaction has already confirmed, so no fee increase is needed. Fiat equivalents use the current price, not necessarily the price at the time of confirmation.'}
    ];
    return [
      {id:'pending', label:'Why is it pending?', text:this.feeInterpretation + ' Miners choose which transactions to include. Transactions that spend unconfirmed outputs also depend on their parents, and related package fees can affect priority. The comparison shown uses the first projected block’s median rate, not a guaranteed fee recommendation.'},
      {id:'time', label:'How long could it take?', text:'The Snapshot estimate reflects the observed queue and mining conditions. New transactions and irregular block times can move it earlier or later; it is not a countdown or deadline. If an estimate is unavailable, that does not by itself mean failure. Queue data was last updated at ' + (this.feeUpdatedAt || 'an unavailable time') + '.' + (this.estimateChanged ? ' The projected block estimate has changed with new network data.' : '')},
      {id:'speed', label:'Can I speed it up?', text:'Waiting remains an option. If timing matters, choose the situation that matches you for relevant fee-increase guidance. Pending Tracker does not control your wallet or change transaction fees.'},
      {id:'lost', label:'Is my money lost?', text:this.replaced || this.rbfTransaction ? 'A replacement has been observed. Follow its link above and verify the receiving outputs; do not assume the original will confirm.' : this.rbfInfo?.mined ? 'A conflicting transaction was mined. Review the linked transaction and contact the sender if needed; this original record is not a confirmed payment.' : this.isCached ? 'This is a cached record. Current network presence has not been verified, so we cannot establish its current state from this record alone.' : 'Our data source currently shows this transaction waiting for confirmation. Pending does not by itself mean your money is lost, and disappearance from one provider does not prove cancellation. Do not send a duplicate payment just because this one is delayed. Verify the intended receiving address. We cannot guarantee eventual confirmation, correct ownership or recovery.'}
    ];
  }
  get snapshotFacts() { return this.snapshotFactsFor(null); }
  snapshotFactsFor(eta: ETA | null) {
    const facts = transactionSnapshot(this.tx, this.latestBlock?.height, this.transactionTime, !!this.replaced || !!this.rbfTransaction, this.pool?.name, this.networkFeeFloor, eta?.wait, this.hasEffectiveFeeRate ? this.tx?.effectiveFeePerVsize : undefined).map(fact => {
      if (fact.label === 'Total output' && this.selectedAddress) return {...fact, label:'To selected address', value:(this.selectedOutputSats / 100000000).toFixed(8) + ' BTC', fiatSats:this.selectedOutputSats, meaning:'Total of outputs to the address you selected.', details:'This amount includes every output to the selected address. Selecting an address does not establish who owns it.'};
      if (fact.label === 'Fee rate' && !this.tx?.status?.confirmed) return {...fact, meaning:this.fastFeeRate && this.ownFeeRate !== undefined ? (this.ownFeeRate < this.fastFeeRate ? 'Below' : 'At or above') + ' the first projected block’s median rate.' : 'Current queue comparison unavailable.', details:fact.details + (this.fastFeeRate ? ' First projected block median: ' + this.fastFeeRate.toFixed(2) + ' sat/vB. This is an observed queue benchmark, not a guaranteed recommended fee.' : '')};
      return fact;
    }).map(fact => {
      const compact: Record<string, string> = {
        'Status': fact.value === 'Replaced' ? 'Follow the replacement transaction.' : this.tx?.status?.confirmed ? 'Recorded in a Bitcoin block.' : 'Awaiting a block; timing can change.',
        'Confirmations': 'Each new block adds a confirmation.',
        'Confirmed at': 'Time reported by the confirming block.',
        'First seen': 'First observed by this data provider.',
        'Included in block': 'The block containing this transaction.',
        'Total output': 'All outputs combined; may include change.',
        'To selected address': 'Outputs to the selected address.',
        'Estimated confirmation': fact.value === 'Not applicable' ? 'Follow the replacement transaction.' : 'Current queue estimate; timing can change.',
        'Waiting': 'Time since this provider first saw it.',
      };
      if (!this.tx?.vin?.some(v => v.is_coinbase)) {
        compact['Network fee'] = 'Miner fee, separate from the amount sent.';
        if (this.tx?.status?.confirmed) compact['Fee rate'] = 'Fee per virtual byte of block space.';
      }
      const meaning = compact[fact.label];
      return meaning ? {...fact, meaning, details:meaning === fact.meaning ? fact.details : fact.meaning + ' ' + fact.details} : fact;
    });
    if (this.replacementCount > 0) facts.push({label:'Replacement history', value:this.replacementCount + (this.replacementCount === 1 ? ' replacement' : ' replacements'), meaning:'Earlier and replacement versions were observed for this transaction history.', details:'A replacement spends inputs also used by an earlier version. Compare the versions and verify the receiving outputs; replacement history does not by itself establish who owns a transaction or guarantee that a replacement preserves its recipients. The diagram links to the observed versions and their fee rates.'});
    return facts;
  }
  get technicalFacts() {
    const facts = transactionTechnicalFacts(this.tx, this.pool?.name, this.transactionTime).filter(fact => !this.pendingTrackerSnapshot || !['Miner attribution','Observed confirmation duration'].includes(fact.label));
    if (this.filters.length) facts.push({label:'Transaction tags', value:this.filters.map(filter => filter.label).join(' · '), meaning:'Characteristics identified by Mempool’s transaction analysis.', details:'These tags describe observed transaction patterns and technical properties. They do not establish ownership, legitimacy or whether a payment is safe. The original technical analysis remains available below.'});
    if (this.auditStatus && this.tx?.status?.confirmed) {
      const audit = this.auditStatus;
      const labels = [audit.coinbase ? 'Mining reward' : audit.expected ? 'Expected in block' : audit.seen ? 'Seen before mining' : !audit.conflict ? 'Not seen before mining' : '', audit.added ? 'Added' : '', audit.prioritized ? 'Prioritized' : '', audit.conflict ? 'Conflict observed' : ''].filter(Boolean);
      facts.push({label:'Block audit', value:labels.join(' · '), meaning:'How this transaction compared with the provider’s observed queue and projected block.', details:'This is Mempool’s observation, not a global view of every Bitcoin node. Expected means projected for inclusion; seen means observed before mining. Added or prioritized can indicate out-of-band inclusion; a conflict means another version was observed. These labels alone do not prove censorship, misconduct or payment legitimacy.'});
    }
    return facts;
  }
  get technicalGroups() {
    const facts = this.technicalFacts || [];
    const groups = [
      { title: 'Size & Weight', description: 'Total size, virtual size, weight units, and related metrics.', matches: /size|weight|sigops|adjusted/i },
      { title: 'Script & Signature Data', description: 'Scripts, signatures, sighash, and witness information.', matches: /script|signature|witness|taproot|segwit|sighash/i },
      { title: 'Timing & Network Data', description: 'First seen, propagation, and network-level details.', matches: /time|seen|network|pool|relay|confirm|accelerat/i },
      { title: 'Version & Locktime', description: 'Transaction version, locktime, and sequence information.', matches: /version|locktime|sequence|replace|rbf/i },
      { title: 'Technical Hex Data', description: 'Raw transaction, hex, and other decoded technical data.', matches: /hex|raw|transaction|feature|flag/i }
    ];
    const assigned = new Set<number>();
    const result = groups.map(group => {
      const members = facts.filter((fact, index) => {
        if (assigned.has(index) || !group.matches.test(fact.label)) return false;
        assigned.add(index);
        return true;
      });
      return { title: group.title, description: group.description, value: members.length ? members[0].value : '—', facts: members };
    });
    const remaining = facts.filter((_, index) => !assigned.has(index));
    if (remaining.length) result[result.length - 1].facts.push(...remaining);
    return result;
  }
  get snapshotSummary() { return transactionSummary(this.tx, !!this.replaced || !!this.rbfTransaction); }
  network = '';
  tx: Transaction;
  txId: string;
  txInBlockIndex: number;
  mempoolPosition: MempoolPosition;
  gotInitialPosition = false;
  accelerationPositions: AccelerationPosition[];
  isLoadingTx = true;
  error: any = undefined;
  errorUnblinded: any = undefined;
  loadingCachedTx = false;
  waitingForTransaction = false;
  latestBlock: BlockExtended;
  transactionTime = -1;
  networkFeeFloor: number | undefined;
  subscription: Subscription;
  fetchCpfpSubscription: Subscription;
  transactionTimesSubscription: Subscription;
  fetchRbfSubscription: Subscription;
  fetchCachedTxSubscription: Subscription;
  fetchAccelerationSubscription: Subscription;
  txReplacedSubscription: Subscription;
  txRbfInfoSubscription: Subscription;
  mempoolPositionSubscription: Subscription;
  queryParamsSubscription: Subscription;
  urlFragmentSubscription: Subscription;
  mempoolBlocksSubscription: Subscription;
  blocksSubscription: Subscription;
  miningSubscription: Subscription;
  auditSubscription: Subscription;
  txConfirmedSubscription: Subscription;
  currencyChangeSubscription: Subscription;
  partnerCodeSubscription: Subscription;
  fragmentParams: URLSearchParams;
  rbfTransaction: undefined | Transaction;
  replaced: boolean = false;
  rbfReplaces: string[];
  rbfInfo: RbfTree;
  cpfpInfo: CpfpInfo | null;
  hasCpfp: boolean = false;
  accelerationInfo: Acceleration | null = null;
  sigops: number | null;
  adjustedVsize: number | null;
  pool: Pool | null;
  auditStatus: TxAuditStatus | null;
  isAcceleration: boolean = false;
  accelerationCanceled: boolean = false;
  filters: Filter[] = [];
  cpfpMode: boolean = false;
  miningStats: MiningStats;
  fetchCpfp$ = new Subject<string>();
  transactionTimes$ = new Subject<string>();
  fetchRbfHistory$ = new Subject<string>();
  fetchCachedTx$ = new Subject<string>();
  fetchAcceleration$ = new Subject<number>();
  fetchMiningInfo$ = new Subject<{ hash: string, height: number, txid: string }>();
  txChanged$ = new BehaviorSubject<boolean>(false); // triggered whenever this.tx changes (long term, we should refactor to make this.tx an observable itself)
  isAccelerated$ = new BehaviorSubject<boolean>(false); // refactor this to make isAccelerated an observable itself
  ETA$: Observable<ETA | null>;
  isCached: boolean = false;
  now = Date.now();
  da$: Observable<DifficultyAdjustment>;
  liquidUnblinding = new LiquidUnblinding();
  inputIndex: number;
  outputIndex: number;
  graphExpanded: boolean = false;
  graphWidth: number = 1068;
  graphHeight: number = 150;
  inOutLimit: number = 150;
  maxInOut: number = 0;
  flowPrefSubscription: Subscription;
  hideFlow: boolean = this.stateService.hideFlow.value;
  overrideFlowPreference: boolean = null;
  flowEnabled: boolean;
  showRbfDiff: boolean = false;

  // The structural diff compares amounts and destinations, and on Liquid neither
  // is well defined: an output carries an arbitrary asset, and a confidential one
  // has no value at all. It stays off there until it is asset aware.
  get isLiquid(): boolean {
    return this.network === 'liquid' || this.network === 'liquidtestnet';
  }
  isDetailsOpen: boolean = false;
  tooltipPosition: { x: number, y: number };
  isMobile: boolean;
  firstLoad = true;
  waitingForAccelerationInfo: boolean = false;
  isLoadingFirstSeen = false;
  notAcceleratedOnLoad: boolean = null;
  duplicateTxBlocks: [number, number] | undefined;

  featuresEnabled: boolean;
  segwitEnabled: boolean;
  rbfEnabled: boolean;
  taprootEnabled: boolean;
  hasEffectiveFeeRate: boolean;
  accelerateCtaType: 'alert' | 'button' = 'button';
  acceleratorAvailable: boolean = this.stateService.env.ACCELERATOR_BUTTON && this.stateService.network === '';
  eligibleForAcceleration: boolean = false;
  forceAccelerationSummary = false;
  hideAccelerationSummary = false;
  accelerationFlowCompleted = false;
  showAccelerationDetails = false;
  hasAccelerationDetails = false;
  auditEnabled: boolean = this.stateService.env.AUDIT && this.stateService.env.BASE_MODULE === 'mempool' && this.stateService.env.MINING_DASHBOARD === true;
  isMempoolSpaceBuild = this.stateService.isMempoolSpaceBuild;
  partnerCode: string | undefined;

  graphContainer: ElementRef;
  private flowResizeObserver?: ResizeObserver;
  private txList: TransactionsListComponent;
  private fragmentAnchor: string | null = null;
  private scrolledFragmentAnchor: string | null = null;
  private firstFragmentScroll = true;

  @ViewChild('txList')
  set txListSetter(component: TransactionsListComponent | undefined) {
    if (component) {
      this.txList = component;
      this.txList.setDetailsOpen(this.isDetailsOpen);
    }
  }

  @ViewChild('graphContainer')
  set flowAnchor(element: ElementRef | null | undefined) {
    this.flowResizeObserver?.disconnect();
    if (element) {
      this.graphContainer = element;
      if (this.stateService.isBrowser && typeof ResizeObserver !== 'undefined') {
        this.flowResizeObserver = new ResizeObserver(() => this.setGraphSize());
        this.flowResizeObserver.observe(element.nativeElement);
      }
      setTimeout(() => { this.setGraphSize(); this.applyFragment(); }, 0);
    }
  }

  @ViewChild('accelerate')
  set accelerateAnchor(element: ElementRef | null | undefined) {
    if (element) {
      setTimeout(() => { this.applyFragment(); }, 0);
    }
  }

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private relativeUrlPipe: RelativeUrlPipe,
    private electrsApiService: ElectrsApiService,
    public stateService: StateService,
    private cacheService: CacheService,
    private websocketService: WebsocketService,
    private audioService: AudioService,
    private apiService: ApiService,
    private servicesApiService: ServicesApiServices,
    private seoService: SeoService,
    private priceService: PriceService,
    private storageService: StorageService,
    private partnerCodeService: PartnerCodeService,
    private miningService: MiningService,
    private etaService: EtaService,
    private cd: ChangeDetectorRef,
    @Inject(ZONE_SERVICE) private zoneService: any,
  ) {}


  readonly exampleId$ = this.route.queryParamMap.pipe(map(params => params.get('example')));
  focusOwnLookup(): void {
    window.scrollTo({top:0, behavior:'auto'});
    this.stateService.searchFocus$.next(true);
  }
  ngOnInit() {
    this.setupPartnerCode();

    this.isDetailsOpen = this.route.snapshot.queryParams['showDetails'] === 'true';
    this.cpfpMode = this.route.snapshot.queryParams['cpfp'] === 'true';

    const urlParams = new URLSearchParams(window.location.search);
    this.forceAccelerationSummary = !!urlParams.get('cash_request_id');

    this.hideAccelerationSummary = this.stateService.isMempoolSpaceBuild ? this.storageService.getValue('hide-accelerator-pref') == 'true' : true;

    if (!this.stateService.isLiquid()) {
      this.miningService.getMiningStats('1m').subscribe(stats => {
        this.miningStats = stats;
      });
    }

    this.websocketService.want(['blocks', 'mempool-blocks']);
    this.stateService.networkChanged$.subscribe(
      (network) => {
        this.network = network;
        this.acceleratorAvailable = this.stateService.env.ACCELERATOR_BUTTON && this.stateService.network === '';
      }
    );

    this.accelerateCtaType = (this.storageService.getValue('accel-cta-type') as 'alert' | 'button') ?? 'button';

    this.setFlowEnabled();
    this.flowPrefSubscription = this.stateService.hideFlow.subscribe((hide) => {
      this.hideFlow = !!hide;
      this.setFlowEnabled();
    });

    this.da$ = this.stateService.difficultyAdjustment$.pipe(
      tap(() => {
        this.now = Date.now();
      })
    );

    this.urlFragmentSubscription = this.route.fragment.subscribe((fragment) => {
      this.updateFragmentParams(fragment);
    });

    this.blocksSubscription = this.stateService.blocks$.subscribe((blocks) => {
      this.latestBlock = blocks[0];
      this.checkConfirmationAlert();
    });

    this.transactionTimesSubscription = this.transactionTimes$.pipe(
      tap(() => {
        this.isLoadingFirstSeen = true;
      }),
      switchMap((txid) => this.apiService.getTransactionTimes$([txid]).pipe(
        retry({ count: 2, delay: 2000 }),
        // Try again until we either get a valid response, or the transaction is confirmed
        repeat({ delay: 2000 }),
        filter((transactionTimes) => transactionTimes?.[0] > 0 || this.tx.status?.confirmed),
        take(1),
      )),
    )
    .subscribe((transactionTimes) => {
      this.isLoadingFirstSeen = false;
      if (transactionTimes?.length && transactionTimes[0]) {
        this.transactionTime = transactionTimes[0];
      }
    });

    this.fetchCpfpSubscription = this.fetchCpfp$
      .pipe(
        switchMap((txId) =>
          this.apiService
            .getCpfpinfo$(txId)
            .pipe(retryWhen((errors) => errors.pipe(
              mergeMap((error) => {
                if (!this.tx?.status || this.tx.status.confirmed) {
                  return throwError(error);
                } else {
                  return of(null);
                }
              }),
              delay(2000)
            )),
            catchError(() => {
              return of(null);
            })
          )
        ),
        catchError(() => {
          return of(null);
        })
      )
      .subscribe((cpfpInfo) => {
        this.setCpfpInfo(cpfpInfo);
      });

    this.fetchRbfSubscription = this.fetchRbfHistory$
    .pipe(
      switchMap((txId) =>
        this.apiService
          .getRbfHistory$(txId)
      ),
      catchError(() => {
        return of(null);
      })
    ).subscribe((rbfResponse) => {
      this.rbfInfo = rbfResponse?.replacements;
      this.rbfReplaces = rbfResponse?.replaces || null;
    });

    this.fetchCachedTxSubscription = this.fetchCachedTx$
    .pipe(
      tap(() => {
        this.loadingCachedTx = true;
      }),
      switchMap((txId) =>
        this.apiService
          .getRbfCachedTx$(txId)
      ),
      catchError(() => {
        return of(null);
      })
    ).subscribe((tx) => {
      this.loadingCachedTx = false;
      if (!tx) {
        this.seoService.logSoft404();
        return;
      }
      this.seoService.clearSoft404();

      if (!this.tx) {
        this.tx = tx;
        this.setFeatures();
        this.isCached = true;
        if (tx.fee === undefined) {
          this.tx.fee = 0;
        }
        this.tx.feePerVsize = tx.fee / (tx.weight / 4);
        this.isLoadingTx = false;
        this.error = undefined;
        this.waitingForTransaction = false;
        this.graphExpanded = false;
        this.transactionTime = tx.firstSeen || 0;
        this.setupGraph();

        this.fetchRbfHistory$.next(this.tx.txid);
        this.txRbfInfoSubscription = this.stateService.txRbfInfo$.subscribe((rbfInfo) => {
          if (this.tx) {
            this.rbfInfo = rbfInfo;
          }
        });
        this.txChanged$.next(true);
      }
    });

    this.fetchAccelerationSubscription = this.fetchAcceleration$.pipe(
      filter(() => this.stateService.env.ACCELERATOR === true),
      tap(() => {
        this.accelerationInfo = null;
        this.setIsAccelerated();
      }),
      switchMap((blockHeight: number) => {
        if (this.stateService.network === '' && this.stateService.env.ACCELERATOR && blockHeight >= 819500 ) {
          return this.servicesApiService.getAccelerationDataForTxid$(this.txId).pipe(
            switchMap((accelerationData: Acceleration) => {
              if (this.tx.acceleration && !accelerationData) { // If the just mined transaction was accelerated, but services backend did not return any acceleration data, retry
                return throwError(() => 'retry');
              }
              return of(accelerationData);
            }),
            retry({
              count: 3,
              delay: (error) => {
                if (error === 'retry') {
                  return timer(2000);
                }
                return throwError(() => error);
              }
            }),
            catchError(() => {
              return of(null);
            })
          );
        } else {
          return of(null);
        }
      }),
      filter((acceleration: Acceleration) => !!acceleration),
    ).subscribe((acceleration: Acceleration) => {
      if (acceleration.txid === this.txId && (acceleration.status === 'completed' || acceleration.status === 'completed_provisional') && acceleration.pools.includes(acceleration.minedByPoolUniqueId)) {
        const boostCost = acceleration.boostCost || acceleration.bidBoost;
        acceleration.acceleratedFeeRate = Math.max(acceleration.effectiveFee, acceleration.effectiveFee + boostCost) / acceleration.effectiveVsize;
        acceleration.boost = boostCost;
        this.tx.acceleratedAt = acceleration.added;
        this.accelerationInfo = acceleration;
      }
      if (acceleration.txid === this.txId && (acceleration.status === 'failed' || acceleration.status === 'failed_provisional')) {
        this.accelerationCanceled = true;
        this.tx.acceleratedAt = acceleration.added;
        this.accelerationInfo = acceleration;
      }
      this.waitingForAccelerationInfo = false;
      this.setIsAccelerated();
    });

    this.miningSubscription = this.fetchMiningInfo$.pipe(
      filter((target) => target.txid === this.txId && !this.pool),
      tap(() => {
        this.pool = null;
      }),
      switchMap(({ hash, height }) => {
        const foundBlock = this.cacheService.getCachedBlock(height) || null;
        return foundBlock ? of(foundBlock.extras.pool) : this.apiService.getBlock$(hash).pipe(
          map(block => block.extras.pool),
          retry({ count: 3, delay: 2000 }),
          catchError(() => of(null))
        );
      }),
      catchError((e) => {
        return of(null);
      })
    ).subscribe(pool => {
      this.pool = pool;
    });

    this.auditSubscription = this.fetchMiningInfo$.pipe(
      filter((target) => target.txid === this.txId),
      tap(() => {
        this.auditStatus = null;
      }),
      switchMap(({ hash, height, txid }) => {
        const auditAvailable = this.isAuditAvailable(height);
        const isCoinbase = this.tx.vin.some(v => v.is_coinbase);
        const fetchAudit = auditAvailable && !isCoinbase;

        const addFirstSeen = (audit: TxAuditStatus | null, hash: string, height: number, txid: string, useFullSummary: boolean) => {
          if (
            this.isFirstSeenAvailable(height)
            && !audit?.firstSeen             // firstSeen is not already in audit
            && (!audit || audit?.seen)       // audit is disabled or tx is already seen (meaning 'firstSeen' is in block summary)
          ) {
            return useFullSummary ?
              this.apiService.getStrippedBlockTransactions$(hash).pipe(
                map(strippedTxs => {
                  return { audit, firstSeen: strippedTxs.find(tx => tx.txid === txid)?.time };
                }),
                catchError(() => of({ audit }))
              ) :
              this.apiService.getStrippedBlockTransaction$(hash, txid).pipe(
                map(strippedTx => {
                  return { audit, firstSeen: strippedTx?.time };
                }),
                catchError(() => of({ audit }))
              );
          }
          return of({ audit });
        };

        if (fetchAudit) {
        // If block audit is already cached, use it to get transaction audit
          const blockAuditLoaded = this.apiService.getBlockAuditLoaded(hash);
          if (blockAuditLoaded) {
            return this.apiService.getBlockAudit$(hash).pipe(
              map(audit => {
                const isAdded = audit.addedTxs.includes(txid);
                const isPrioritized = audit.prioritizedTxs.includes(txid);
                const isAccelerated = audit.acceleratedTxs.includes(txid);
                const isConflict = audit.fullrbfTxs.includes(txid);
                const isExpected = audit.template.some(tx => tx.txid === txid);
                const firstSeen = audit.template.find(tx => tx.txid === txid)?.time;
                const wasSeen = audit.version === 1 ? !audit.unseenTxs.includes(txid) : (isExpected || isPrioritized || isAccelerated);
                return {
                  seen: wasSeen,
                  expected: isExpected,
                  added: isAdded && (audit.version === 0 || !wasSeen),
                  prioritized: isPrioritized,
                  conflict: isConflict,
                  accelerated: isAccelerated,
                  firstSeen,
                };
              }),
              switchMap(audit => addFirstSeen(audit, hash, height, txid, true)),
              catchError(() => {
                return of({ audit: null });
              })
            );
          } else {
            return this.apiService.getBlockTxAudit$(hash, txid).pipe(
              retry({ count: 3, delay: 2000 }),
              switchMap(audit => addFirstSeen(audit, hash, height, txid, false)),
              catchError(() => {
                return of({ audit: null });
              })
            );
          }
        } else {
          const audit = isCoinbase ? { coinbase: true } : null;
          return addFirstSeen(audit, hash, height, txid, this.apiService.getBlockSummaryLoaded(hash));
        }
      }),
    ).subscribe(auditStatus => {
      this.auditStatus = auditStatus?.audit;
      const firstSeen = this.auditStatus?.firstSeen || auditStatus['firstSeen'];
      if (firstSeen) {
        this.transactionTime = firstSeen;
      }
      this.setIsAccelerated();
    });

    this.mempoolPositionSubscription = this.stateService.mempoolTxPosition$.subscribe(txPosition => {
      this.now = Date.now();
      if (txPosition && txPosition.txid === this.txId && txPosition.position) {
        this.mempoolPosition = txPosition.position;
        this.accelerationPositions = txPosition.accelerationPositions;
        if (this.tx && !this.tx.status.confirmed) {
          const txFeePerVSize = getUnacceleratedFeeRate(this.tx, this.tx.acceleration || this.mempoolPosition?.accelerated);
          this.stateService.markBlock$.next({
            txid: txPosition.txid,
            txFeePerVSize,
            mempoolPosition: this.mempoolPosition,
            accelerationPositions: this.accelerationPositions,
          });
          this.txInBlockIndex = this.mempoolPosition.block;

          if (txPosition.cpfp !== undefined) {
            if (txPosition.position.acceleratedBy) {
              txPosition.cpfp.acceleratedBy = txPosition.position.acceleratedBy;
            }
            if (txPosition.position.acceleratedAt) {
              txPosition.cpfp.acceleratedAt = txPosition.position.acceleratedAt;
            }
            if (txPosition.position.feeDelta) {
              txPosition.cpfp.feeDelta = txPosition.position.feeDelta;
            }
            this.setCpfpInfo(txPosition.cpfp);
          } else if ((this.tx?.acceleration)) {
            if (txPosition.position.acceleratedBy) {
              this.tx.acceleratedBy = txPosition.position.acceleratedBy;
            }
            if (txPosition.position.acceleratedAt) {
              this.tx.acceleratedAt = txPosition.position.acceleratedAt;
            }
            if (txPosition.position.feeDelta) {
              this.tx.feeDelta = txPosition.position.feeDelta;
            }
          }

          if (this.stateService.network === '') {
            if (!this.mempoolPosition.accelerated) {
              if (!this.accelerationFlowCompleted && !this.hideAccelerationSummary && !this.showAccelerationSummary) {
                this.miningService.getMiningStats('1m').subscribe(stats => {
                  this.miningStats = stats;
                });
              }
            }
          }
        }
        this.gotInitialPosition = true;
      } else {
        this.mempoolPosition = null;
        this.accelerationPositions = null;
      }
    });

    this.subscription = this.zoneService.wrapObservable(this.route.paramMap
      .pipe(
        switchMap((params: ParamMap) => {
          this.activeSummaryQuestion = '';
          this.summaryExpanded = false;
          if (this.txId !== (params.get('id') || '').split(':')[0]) {
            this.showReplacementDiagram = false;
            this.showRbfDiff = false;
          }
          const urlMatch = (params.get('id') || '').split(':');
          if (urlMatch.length === 2 && urlMatch[1].length === 64) {
            const vin = parseInt(urlMatch[0], 10);
            this.txId = urlMatch[1];
            // rewrite legacy vin syntax
            if (!isNaN(vin)) {
              this.fragmentParams.set('vin', vin.toString());
              this.fragmentParams.delete('vout');
            }
            this.router.navigate([this.relativeUrlPipe.transform('/tx'), this.txId], {
              queryParamsHandling: 'merge',
              fragment: this.formatFragment(this.fragmentParams),
            });
          } else {
            this.txId = urlMatch[0];
            const vout = parseInt(urlMatch[1], 10);
            if (urlMatch.length > 1 && !isNaN(vout)) {
              // rewrite legacy vout syntax
              this.fragmentParams.set('vout', vout.toString());
              this.fragmentParams.delete('vin');
              this.router.navigate([this.relativeUrlPipe.transform('/tx'), this.txId], {
                queryParamsHandling: 'merge',
                fragment: this.formatFragment(this.fragmentParams),
              });
            }
          }
          if (this.network === '' && this.txId) {
            this.duplicateTxBlocks = DUPLICATE_TX_BLOCKS[this.txId?.toLowerCase()];
          }
          if (window.innerWidth <= 767.98) {
            this.router.navigate([this.relativeUrlPipe.transform('/tx'), this.txId], {
              queryParamsHandling: 'merge',
              fragment: this.formatFragment(this.fragmentParams, this.fragmentAnchor),
              queryParams: { mode: 'details' },
              replaceUrl: true,
            });
          }
          this.seoService.setTitle(
            $localize`:@@bisq.transaction.browser-title:Transaction: ${this.txId}:INTERPOLATION:`
          );
          const network = this.stateService.network === 'liquid' || this.stateService.network === 'liquidtestnet' ? 'Liquid' : 'Bitcoin';
          const seoDescription = seoDescriptionNetwork(this.stateService.network);
          this.seoService.setDescription($localize`:@@meta.description.bitcoin.transaction:Get real-time status, addresses, fees, script info, and more for ${network}${seoDescription} transaction with txid ${this.txId}.`);
          this.resetTransaction();

          return merge(
            of(true),
            this.stateService.connectionState$.pipe(
              filter(
                (state) => state === 2 && this.tx && !this.tx.status?.confirmed
              )
            )
          );
        }),
        switchMap(() => {
          let transactionObservable$: Observable<Transaction>;
          const cached = this.cacheService.getTxFromCache(this.txId);
          if (cached && cached.fee !== -1) {
            transactionObservable$ = of(cached);
          } else {
            transactionObservable$ = this.electrsApiService
              .getTransaction$(this.txId)
              .pipe(
                catchError(this.handleLoadElectrsTransactionError.bind(this))
              );
          }
          return merge(
            transactionObservable$,
            this.stateService.mempoolTransactions$
          );
        }),
        switchMap((tx) => {
          if (this.network === 'liquid' || this.network === 'liquidtestnet') {
            return from(this.liquidUnblinding.checkUnblindedTx(tx))
              .pipe(
                catchError((error) => {
                  this.errorUnblinded = error;
                  return of(tx);
                })
              );
          }
          return of(tx);
        })
      ))
      .subscribe((tx: Transaction) => {
          if (!tx) {
            this.fetchCachedTx$.next(this.txId);
            this.seoService.logSoft404();
            return;
          }
          this.seoService.clearSoft404();

          this.tx = tx;
          this.setFeatures();
          this.isCached = false;
          if (tx.fee === undefined) {
            this.tx.fee = 0;
          }
          if (this.tx.sigops != null) {
            this.sigops = this.tx.sigops;
            this.adjustedVsize = Math.max(this.tx.weight / 4, this.sigops * 5);
          }
          this.tx.feePerVsize = tx.fee / (tx.weight / 4);
          this.txChanged$.next(true);
          this.isLoadingTx = false;
          this.error = undefined;
          this.loadingCachedTx = false;
          this.waitingForTransaction = false;
          this.websocketService.startTrackTransaction(tx.txid);
          this.graphExpanded = false;
          this.setupGraph();

          if (!tx.status?.confirmed) {
            if (tx.firstSeen) {
              this.transactionTime = tx.firstSeen;
            } else {
              this.transactionTimes$.next(tx.txid);
            }
          } else {
            this.fetchAcceleration$.next(tx.status.block_height);
            this.fetchMiningInfo$.next({ hash: tx.status.block_hash, height: tx.status.block_height, txid: tx.txid });
            this.transactionTime = 0;
          }

          if (this.tx?.status?.confirmed) {
            this.stateService.markBlock$.next({
              blockHeight: tx.status.block_height,
            });
            this.fetchCpfp$.next(this.tx.txid);
          } else {
            const txFeePerVSize = getUnacceleratedFeeRate(this.tx, this.tx.acceleration || this.mempoolPosition?.accelerated);
            if (tx.cpfpChecked) {
              this.stateService.markBlock$.next({
                txid: tx.txid,
                txFeePerVSize,
                mempoolPosition: this.mempoolPosition,
                accelerationPositions: this.accelerationPositions,
              });
              this.setCpfpInfo({
                ancestors: tx.ancestors,
                bestDescendant: tx.bestDescendant,
              });
              const hasRelatives = !!(tx.ancestors?.length || tx.bestDescendant || tx.descendants);
              this.hasEffectiveFeeRate = hasRelatives || (tx.effectiveFeePerVsize && tx.effectiveFeePerVsize !== (this.tx.fee / (this.tx.weight / 4)) && tx.effectiveFeePerVsize !== (tx.fee / Math.ceil(tx.weight / 4)));
            } else {
              this.fetchCpfp$.next(this.tx.txid);
            }
          }
          this.fetchRbfHistory$.next(this.tx.txid);
          this.currencyChangeSubscription?.unsubscribe();
          this.currencyChangeSubscription = this.stateService.fiatCurrency$.pipe(
            switchMap((currency) => {
              return tx.status.block_time ? this.priceService.getBlockPrice$(tx.status.block_time, true, currency).pipe(
                tap((price) => tx['price'] = price),
              ) : of(undefined);
            })
          ).subscribe();

          this.cd.detectChanges();
        },
        (error) => {
          this.error = error;
          this.seoService.logSoft404();
          this.isLoadingTx = false;
        }
      );

    this.txConfirmedSubscription = this.stateService.txConfirmed$.subscribe(([txConfirmed, block]) => {
      if (txConfirmed && this.tx && !this.tx.status.confirmed && txConfirmed === this.tx.txid) {
        if (this.tx.acceleration) {
          this.waitingForAccelerationInfo = true;
        }
        this.tx.status = {
          confirmed: true,
          block_height: block.height,
          block_hash: block.id,
          block_time: block.timestamp,
        };
        this.pool = block.extras.pool;
        this.checkConfirmationAlert();
        this.txChanged$.next(true);
        this.stateService.markBlock$.next({ blockHeight: block.height });
        if (this.tx.acceleration || (this.accelerationInfo && ['accelerating', 'completed_provisional', 'completed'].includes(this.accelerationInfo.status))) {
          this.audioService.playSound('wind-chimes-harp-ascend');
        } else {
          this.audioService.playSound('magic');
        }
        this.fetchAcceleration$.next(block.height);
        this.fetchMiningInfo$.next({ hash: block.id, height: block.height, txid: this.tx.txid });
      }
    });

    this.txReplacedSubscription = this.stateService.txReplaced$.subscribe((rbfTransaction) => {
      if (!this.tx) {
        this.error = new Error();
        this.loadingCachedTx = false;
        this.waitingForTransaction = false;
      }
      this.rbfTransaction = rbfTransaction;
      this.replaced = true;
      this.stateService.markBlock$.next({});

      if (rbfTransaction && !this.tx) {
        this.fetchCachedTx$.next(this.txId);
      }
    });

    this.txRbfInfoSubscription = this.stateService.txRbfInfo$.subscribe((rbfInfo) => {
      if (this.tx) {
        this.rbfInfo = rbfInfo;
      }
    });

    this.queryParamsSubscription = this.route.queryParams.subscribe((params) => {
      if (params.showFlow === 'false') {
        this.overrideFlowPreference = false;
      } else if (params.showFlow === 'true') {
        this.overrideFlowPreference = true;
      } else {
        this.overrideFlowPreference = null;
      }
      this.setFlowEnabled();
      this.setGraphSize();
    });

    this.mempoolBlocksSubscription = this.stateService.mempoolBlocks$.subscribe((mempoolBlocks) => {
      this.now = Date.now();
      const firstFeeRange = mempoolBlocks?.[0]?.feeRange;
      this.fastFeeRate = Number.isFinite(mempoolBlocks?.[0]?.medianFee) ? mempoolBlocks[0].medianFee : undefined;
      this.feeUpdatedAt = new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
      this.networkFeeFloor = firstFeeRange?.length && Number.isFinite(firstFeeRange[0]) ? firstFeeRange[0] : undefined;

      if (!this.tx || this.mempoolPosition) {
        return;
      }

      const txFeePerVSize =
        this.tx.effectiveFeePerVsize || this.tx.fee / (this.tx.weight / 4);

      let found = false;
      this.txInBlockIndex = 0;
      for (const block of mempoolBlocks) {
        for (let i = 0; i < block.feeRange.length - 1 && !found; i++) {
          if (
            txFeePerVSize <= block.feeRange[i + 1] &&
            txFeePerVSize >= block.feeRange[i]
          ) {
            this.txInBlockIndex = mempoolBlocks.indexOf(block);
            found = true;
          }
        }
      }
      if (!found && mempoolBlocks.length && txFeePerVSize < mempoolBlocks[mempoolBlocks.length - 1].feeRange[0]) {
        this.txInBlockIndex = 7;
      }
    });

    this.ETA$ = combineLatest([
      this.stateService.mempoolTxPosition$.pipe(startWith(null)),
      this.stateService.mempoolBlocks$.pipe(startWith(null)),
      this.stateService.difficultyAdjustment$.pipe(startWith(null)),
      this.isAccelerated$,
      this.txChanged$,
    ]).pipe(
      map(([position, mempoolBlocks, da, isAccelerated]) => {
        if (!this.tx || !position || position.txid !== this.tx.txid) {
          return null;
        }
        return this.etaService.calculateETA(
          this.network,
          this.tx,
          mempoolBlocks,
          position,
          da,
          this.miningStats,
          isAccelerated,
          this.accelerationPositions,
        );
      }),
      distinctUntilChanged((prev: ETA | null, curr: ETA | null) => {
        return prev === curr || (prev && curr && prev.time === curr.time && prev.blocks === curr.blocks);
      }),
      tap(eta => {
        if (eta && this.tx) {
          if (this.previousEta?.txid !== this.tx.txid) this.estimateChanged = false;
          else if (this.previousEta.blocks !== eta.blocks) this.estimateChanged = true;
          this.previousEta = {txid:this.tx.txid, blocks:eta.blocks};
        }
      })
    );
  }

  ngAfterViewInit(): void {
    this.setGraphSize();
  }

  toggleDetailsFromTxPage(): void {
    this.isDetailsOpen = !this.isDetailsOpen;
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { showDetails: this.isDetailsOpen ? 'true' : null },
      queryParamsHandling: 'merge',
      fragment: this.formatFragment(this.fragmentParams),
      replaceUrl: true,
    });
    this.txList?.setDetailsOpen(this.isDetailsOpen);
  }

  dismissAccelAlert(): void {
    this.storageService.setValue('accel-cta-type', 'button');
    this.accelerateCtaType = 'button';
  }

  onAccelerateClicked() {
    if (!this.txId) {
      return;
    }

    this.openAccelerator();
    return false;
  }

  handleLoadElectrsTransactionError(error: any): Observable<any> {
    if (error.status === 404 && /^[a-fA-F0-9]{64}$/.test(this.txId)) {
      this.websocketService.startMultiTrackTransaction(this.txId);
      this.waitingForTransaction = true;
    }
    this.error = error;
    this.seoService.logSoft404();
    this.isLoadingTx = false;
    return of(false);
  }

  setCpfpInfo(cpfpInfo: CpfpInfo): void {
    if (!cpfpInfo || !this.tx) {
      this.cpfpInfo = null;
      this.hasCpfp = false;
      this.hasEffectiveFeeRate = false;
      return;
    }
    const firstCpfp = this.cpfpInfo == null;
    // merge ancestors/descendants
    const relatives = [...(cpfpInfo.ancestors || []), ...(cpfpInfo.descendants || [])];
    if (cpfpInfo.bestDescendant && !cpfpInfo.descendants?.length) {
      relatives.push(cpfpInfo.bestDescendant);
    }
    const hasRelatives = !!relatives.length;
    if (!cpfpInfo.effectiveFeePerVsize && hasRelatives) {
      const totalWeight =
        this.tx.weight +
        relatives.reduce((prev, val) => prev + val.weight, 0);
      const totalFees =
        this.tx.fee +
        relatives.reduce((prev, val) => prev + val.fee, 0);
      this.tx.effectiveFeePerVsize = totalFees / (totalWeight / 4);
    } else {
      this.tx.effectiveFeePerVsize = cpfpInfo.effectiveFeePerVsize || this.tx.effectiveFeePerVsize || this.tx.feePerVsize || (this.tx.fee / (this.tx.weight / 4));
    }
    if (cpfpInfo.acceleration) {
      this.tx.acceleration = cpfpInfo.acceleration;
      this.tx.acceleratedBy = cpfpInfo.acceleratedBy;
      this.tx.acceleratedAt = cpfpInfo.acceleratedAt;
      this.tx.feeDelta = cpfpInfo.feeDelta;
      this.accelerationCanceled = false;
      this.setIsAccelerated(firstCpfp);
    } else if (cpfpInfo.acceleratedAt) { // Acceleration was cancelled: reset acceleration state
      this.tx.acceleratedBy = cpfpInfo.acceleratedBy;
      this.tx.acceleratedAt = cpfpInfo.acceleratedAt;
      this.tx.feeDelta = cpfpInfo.feeDelta;
      this.accelerationCanceled = true;
      this.setIsAccelerated(firstCpfp);
    }

    if (this.notAcceleratedOnLoad === null) {
      this.notAcceleratedOnLoad = !this.isAcceleration;
    }

    this.txChanged$.next(true);

    this.cpfpInfo = cpfpInfo;
    if (this.cpfpInfo.adjustedVsize && this.cpfpInfo.sigops != null) {
      this.sigops = this.cpfpInfo.sigops;
      this.adjustedVsize = this.cpfpInfo.adjustedVsize;
    }
    this.hasCpfp =!!(this.cpfpInfo && relatives.length);
    this.hasEffectiveFeeRate = hasRelatives || (this.tx.effectiveFeePerVsize && this.tx.effectiveFeePerVsize !== (this.tx.fee / (this.tx.weight / 4)) && this.tx.effectiveFeePerVsize !== (this.tx.fee / Math.ceil(this.tx.weight / 4)));
  }

  setIsAccelerated(initialState: boolean = false) {
    this.isAcceleration =
      (
        (this.tx.acceleration && (!this.tx.status.confirmed || this.waitingForAccelerationInfo)) ||
        (this.accelerationInfo && this.pool && this.accelerationInfo.pools.some(pool => (pool === this.pool.id)))
      ) &&
      !this.accelerationCanceled;
    if (this.isAcceleration) {
      if (initialState) {
        this.accelerationFlowCompleted = true;
      }
    }
    if (this.isAcceleration) {
      // this immediately returns cached stats if we fetched them recently
      this.miningService.getMiningStats('1m').subscribe(stats => {
        this.miningStats = stats;
        this.isAccelerated$.next(this.isAcceleration); // hack to trigger recalculation of ETA without adding another source observable
      });
    }
    this.isAccelerated$.next(this.isAcceleration);
  }

  setFeatures(): void {
    if (this.tx) {
      this.segwitEnabled = !this.tx.status.confirmed || isFeatureActive(this.stateService.network, this.tx.status.block_height, 'segwit');
      this.taprootEnabled = !this.tx.status.confirmed || isFeatureActive(this.stateService.network, this.tx.status.block_height, 'taproot');
      this.rbfEnabled = !this.tx.status.confirmed || isFeatureActive(this.stateService.network, this.tx.status.block_height, 'rbf');
      const txHeight = this.tx.status?.block_height || (this.stateService.latestBlockHeight >= 0 ? this.stateService.latestBlockHeight + 1 : null);
      this.tx.flags = getTransactionFlags(this.tx, null, null, txHeight, this.stateService.network);
      this.filters = this.tx.flags ? toFilters(this.tx.flags).filter(f => f.txPage) : [];
      this.checkAccelerationEligibility();
    } else {
      this.segwitEnabled = false;
      this.taprootEnabled = false;
      this.rbfEnabled = false;
    }
    this.featuresEnabled = this.segwitEnabled || this.taprootEnabled || this.rbfEnabled;
  }

  checkAccelerationEligibility() {
    if (this.tx && this.tx.flags) {
      const replaceableInputs = (this.tx.flags & (TransactionFlags.sighash_none | TransactionFlags.sighash_acp)) > 0n;
      const highSigop = (this.tx.sigops * 20) > this.tx.weight;
      this.eligibleForAcceleration = !replaceableInputs && !highSigop;
    } else {
      this.eligibleForAcceleration = false;
    }
  }

  isAuditAvailable(blockHeight: number): boolean {
    if (!this.auditEnabled) {
      return false;
    }
    switch (this.stateService.network) {
      case 'testnet':
        if (blockHeight < this.stateService.env.TESTNET_BLOCK_AUDIT_START_HEIGHT) {
          return false;
        }
        break;
      case 'testnet4':
        if (blockHeight < this.stateService.env.TESTNET4_BLOCK_AUDIT_START_HEIGHT) {
          return false;
        }
        break;
      case 'signet':
        if (blockHeight < this.stateService.env.SIGNET_BLOCK_AUDIT_START_HEIGHT) {
          return false;
        }
        break;
      default:
        if (blockHeight < this.stateService.env.MAINNET_BLOCK_AUDIT_START_HEIGHT) {
          return false;
        }
    }
    return true;
  }

  isFirstSeenAvailable(blockHeight: number): boolean {
    if (this.stateService.env.BASE_MODULE !== 'mempool') {
      return false;
    }
    switch (this.stateService.network) {
      case 'testnet':
        if (this.stateService.env.TESTNET_TX_FIRST_SEEN_START_HEIGHT && blockHeight >= this.stateService.env.TESTNET_TX_FIRST_SEEN_START_HEIGHT) {
          return true;
        }
        break;
      case 'testnet4':
        if (this.stateService.env.TESTNET4_TX_FIRST_SEEN_START_HEIGHT && blockHeight >= this.stateService.env.TESTNET4_TX_FIRST_SEEN_START_HEIGHT) {
          return true;
        }
        break;
      case 'signet':
        if (this.stateService.env.SIGNET_TX_FIRST_SEEN_START_HEIGHT && blockHeight >= this.stateService.env.SIGNET_TX_FIRST_SEEN_START_HEIGHT) {
          return true;
        }
        break;
      default:
        if (this.stateService.env.MAINNET_TX_FIRST_SEEN_START_HEIGHT && blockHeight >= this.stateService.env.MAINNET_TX_FIRST_SEEN_START_HEIGHT) {
          return true;
        }
    }
    return false;
  }

  resetTransaction() {
    this.selectedAddress = ''; this.addressFeedback = ''; this.helpRole = ''; this.estimateChanged = false; this.alertMessage = ''; this.alertTxid = ''; this.selectedAlertTarget = 0; this.alertRequestPending = false;
    this.firstLoad = false;
    this.firstFragmentScroll = this.fragmentAnchor !== null;
    this.scrolledFragmentAnchor = null;
    this.gotInitialPosition = false;
    this.error = undefined;
    this.tx = null;
    this.txChanged$.next(true);
    this.setFeatures();
    this.waitingForTransaction = false;
    this.isLoadingTx = true;
    this.rbfTransaction = undefined;
    this.replaced = false;
    this.transactionTime = -1;
    this.cpfpInfo = null;
    this.adjustedVsize = null;
    this.sigops = null;
    this.hasEffectiveFeeRate = false;
    this.rbfInfo = null;
    this.rbfReplaces = [];
    this.filters = [];
    this.showAccelerationDetails = false;
    this.accelerationFlowCompleted = false;
    this.accelerationInfo = null;
    this.notAcceleratedOnLoad = null;
    this.txInBlockIndex = null;
    this.mempoolPosition = null;
    this.pool = null;
    this.auditStatus = null;
    this.accelerationPositions = null;
    this.isDetailsOpen = this.route.snapshot.queryParams['showDetails'] === 'true';
    this.cpfpMode = this.route.snapshot.queryParams['cpfp'] === 'true';
    document.body.scrollTo(0, 0);
    this.isAcceleration = false;
    this.isAccelerated$.next(this.isAcceleration);
    this.eligibleForAcceleration = false;
    this.leaveTransaction();
  }

  leaveTransaction() {
    this.websocketService.stopTrackingTransaction();
    this.stateService.markBlock$.next({});
  }

  setupGraph() {
    this.maxInOut = Math.min(this.inOutLimit, Math.max(this.tx?.vin?.length || 1, this.tx?.vout?.length + 1 || 1));
    this.graphHeight = this.graphExpanded ? this.maxInOut * 15 : Math.min(this.pendingTrackerSnapshot ? 190 : 270, Math.max(this.pendingTrackerSnapshot ? 110 : 150, this.maxInOut * 55));
  }

  toggleCpfp() {
    this.cpfpMode = !this.cpfpMode;
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { cpfp: this.cpfpMode ? 'true' : null },
      queryParamsHandling: 'merge',
      fragment: this.formatFragment(this.fragmentParams),
      replaceUrl: true,
    });
  }

  private formatFragment(fragmentParams: URLSearchParams, anchor: string | null = null): string | null {
    const params = new URLSearchParams(fragmentParams);
    for (const [key, value] of Array.from(params.entries())) {
      if (value === '') {
        params.delete(key);
      }
    }
    if (anchor) {
      params.set(anchor, '');
    }
    return Array.from(params.entries()).map(([key, value]) => value ? `${key}=${value}` : key).join('&') || null;
  }

  toggleGraph() {
    const showFlow = !this.flowEnabled;
    this.stateService.hideFlow.next(!showFlow);
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { showFlow: showFlow },
      queryParamsHandling: 'merge',
      fragment: this.formatFragment(this.fragmentParams, showFlow ? 'flow' : null)
    });
  }

  setFlowEnabled() {
    this.flowEnabled = (this.overrideFlowPreference != null ? this.overrideFlowPreference : !this.hideFlow);
  }

  expandGraph() {
    this.graphExpanded = true;
    this.graphHeight = this.maxInOut * 15;
  }

  collapseGraph() {
    this.graphExpanded = false;
    this.graphHeight = Math.min(this.pendingTrackerSnapshot ? 190 : 270, Math.max(this.pendingTrackerSnapshot ? 110 : 150, this.maxInOut * 55));
  }

  // simulate normal anchor fragment behavior
  applyFragment(): void {
    if (this.fragmentAnchor && this.scrolledFragmentAnchor !== this.fragmentAnchor) {
      const anchorElement = document.getElementById(this.fragmentAnchor);
      if (anchorElement) {
        anchorElement.scrollIntoView({ behavior: this.firstFragmentScroll ? 'auto' : 'smooth' });
        this.firstFragmentScroll = false;
        this.scrolledFragmentAnchor = this.fragmentAnchor;
      }
    }
  }

  updateFragmentParams(fragment: string | null): void {
    this.fragmentParams = new URLSearchParams(fragment || '');
    // remove any partnerCode param from the URL and pass it to the partnerCodeService
    if (this.fragmentParams.has('partnerCode')) {
      const partnerCode = this.fragmentParams.get('partnerCode');
      if (partnerCode) {
        this.partnerCodeService.setFragmentPartnerCode(partnerCode);
      }
      this.fragmentParams.delete('partnerCode');
      // update the URL with the new fragment string in a way Angular Router understands
      const anchor = Array.from(this.fragmentParams.entries()).find(([, value]) => value === '')?.[0] || null;
      this.router.navigate([], {
        relativeTo: this.route,
        fragment: this.formatFragment(this.fragmentParams, anchor),
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    }
    const vin = parseInt(this.fragmentParams.get('vin'), 10);
    const vout = parseInt(this.fragmentParams.get('vout'), 10);
    const inputIndex = (!isNaN(vin) && vin >= 0) ? vin : null;
    const outputIndex = (!isNaN(vout) && vout >= 0) ? vout : null;
    const selectionChanged = inputIndex !== this.inputIndex || outputIndex !== this.outputIndex;
    const anchor = Array.from(this.fragmentParams.entries()).find(([, value]) => value === '')?.[0] || null;
    this.inputIndex = inputIndex;
    this.outputIndex = outputIndex;
    if (this.fragmentParams.has('accelerate')) {
      this.forceAccelerationSummary = true;
    }
    if (!anchor && !this.fragmentAnchor) {
      this.firstFragmentScroll = false;
    }
    if (selectionChanged && anchor) {
      this.scrolledFragmentAnchor = null;
    }
    if (anchor !== this.fragmentAnchor) {
      this.fragmentAnchor = anchor;
      this.scrolledFragmentAnchor = null;
      if (!this.fragmentAnchor) {
        this.firstFragmentScroll = false;
      }
    }
    if (this.scrolledFragmentAnchor !== this.fragmentAnchor) {
      if (this.fragmentAnchor) {
        setTimeout(() => { this.applyFragment(); }, 0);
      } else {
        this.firstFragmentScroll = false;
      }
    }
  }

  setHasAccelerationDetails(hasDetails: boolean): void {
    this.hasAccelerationDetails = hasDetails;
  }

  @HostListener('window:resize', ['$event'])
  setGraphSize(): void {
    this.isMobile = window.innerWidth < 850;
    this.phoneLayout = window.innerWidth <= 767.98;
    if (this.graphContainer?.nativeElement && this.stateService.isBrowser) {
      setTimeout(() => {
        if (this.graphContainer?.nativeElement?.clientWidth) {
          const width = this.graphContainer.nativeElement.clientWidth;
          if (width !== this.graphWidth) {
            this.graphWidth = width;
            this.cd.markForCheck();
          }
        } else {
          setTimeout(() => { this.setGraphSize(); }, 1);
        }
      }, 1);
    }
  }

  isLoggedIn(): boolean {
    const auth = this.storageService.getAuth();
    return auth !== null;
  }

  onAccelerationCompleted(): void {
    this.router.navigate([], { fragment: this.formatFragment(this.fragmentParams), queryParamsHandling: 'merge' });
    this.accelerationFlowCompleted = true;
    this.forceAccelerationSummary = false;
  }

  closeAccelerator(): void {
    this.router.navigate([], { fragment: this.formatFragment(this.fragmentParams), queryParamsHandling: 'merge' });
    this.hideAccelerationSummary = true;
    this.forceAccelerationSummary = false;
    this.storageService.setValue('hide-accelerator-pref', 'true');
  }

  openAccelerator(): void {
    this.router.navigate([], { fragment: this.formatFragment(this.fragmentParams, 'accelerate'), queryParamsHandling: 'merge' });
    this.accelerationFlowCompleted = false;
    this.hideAccelerationSummary = false;
    this.storageService.setValue('hide-accelerator-pref', 'false');
  }

  get showAccelerationSummary(): boolean {
    return (
      this.tx
      && !this.replaced
      && !this.isCached
      && this.acceleratorAvailable
      && this.eligibleForAcceleration
      && (
        (!this.hideAccelerationSummary && !this.accelerationFlowCompleted)
        || this.forceAccelerationSummary
      )
      && this.notAcceleratedOnLoad // avoid briefly showing accelerator checkout on already accelerated txs
    );
  }

  ngOnDestroy() {
    this.flowResizeObserver?.disconnect();
    this.subscription.unsubscribe();
    this.fetchCpfpSubscription.unsubscribe();
    this.transactionTimesSubscription.unsubscribe();
    this.fetchRbfSubscription.unsubscribe();
    this.fetchCachedTxSubscription.unsubscribe();
    this.fetchAccelerationSubscription.unsubscribe();
    this.txReplacedSubscription.unsubscribe();
    this.txRbfInfoSubscription.unsubscribe();
    this.queryParamsSubscription.unsubscribe();
    this.flowPrefSubscription.unsubscribe();
    this.urlFragmentSubscription.unsubscribe();
    this.mempoolBlocksSubscription.unsubscribe();
    this.mempoolPositionSubscription.unsubscribe();
    this.blocksSubscription.unsubscribe();
    this.miningSubscription?.unsubscribe();
    this.auditSubscription?.unsubscribe();
    this.txConfirmedSubscription?.unsubscribe();
    this.currencyChangeSubscription?.unsubscribe();
    this.leaveTransaction();
    this.partnerCodeSubscription?.unsubscribe();
  }

  setupPartnerCode(): void {
    this.partnerCodeSubscription?.unsubscribe();
    this.partnerCodeSubscription = this.partnerCodeService.partnerCode$.subscribe((partnerCode) => {
      this.partnerCode = partnerCode;
    });
  }
}
