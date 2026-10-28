import { walletOverview } from '@app/shared/overview-content';
import { mobilePopoverVisibleHeight, revealMobileHelpAnswer } from '@app/shared/mobile-popover-visibility';
import { walletView, addressTransactionChange } from './wallet-view';
import { Component, OnInit, OnDestroy, HostListener } from '@angular/core';
import { UntypedFormBuilder, UntypedFormGroup } from '@angular/forms';
import { ActivatedRoute, ParamMap } from '@angular/router';
import { ElectrsApiService } from '@app/services/electrs-api.service';
import { switchMap, filter, catchError, map, tap } from 'rxjs/operators';
import { Address, ChainStats, Transaction, Utxo, Vin } from '@interfaces/electrs.interface';
import { WebsocketService } from '@app/services/websocket.service';
import { StateService } from '@app/services/state.service';
import { AudioService } from '@app/services/audio.service';
import { ApiService } from '@app/services/api.service';
import { of, merge, Subscription, Observable, forkJoin } from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { seoDescriptionNetwork } from '@app/shared/common.utils';
import { AddressInformation } from '@interfaces/node-api.interface';
import { AddressTypeInfo } from '@app/shared/address-utils';
import { extractTapLeaves, fillTapTree, convertTextToBuffer, PsbtKeyValue } from '@app/shared/transaction.utils';

class AddressStats implements ChainStats {
  address: string;
  scriptpubkey?: string;
  funded_txo_count: number;
  funded_txo_sum: number;
  spent_txo_count: number;
  spent_txo_sum: number;
  tx_count: number;

  constructor (stats: ChainStats, address: string, scriptpubkey?: string) {
    Object.assign(this, stats);
    this.address = address;
    this.scriptpubkey = scriptpubkey;
  }

  public addTx(tx: Transaction): void {
    for (const vin of tx.vin) {
      if (vin.prevout?.scriptpubkey_address === this.address || (this.scriptpubkey === vin.prevout?.scriptpubkey)) {
        this.spendTxo(vin.prevout.value);
      }
    }
    for (const vout of tx.vout) {
      if (vout.scriptpubkey_address === this.address || (this.scriptpubkey === vout.scriptpubkey)) {
        this.fundTxo(vout.value);
      }
    }
    this.tx_count++;
  }

  public removeTx(tx: Transaction): void {
    for (const vin of tx.vin) {
      if (vin.prevout?.scriptpubkey_address === this.address || (this.scriptpubkey === vin.prevout?.scriptpubkey)) {
        this.unspendTxo(vin.prevout.value);
      }
    }
    for (const vout of tx.vout) {
      if (vout.scriptpubkey_address === this.address || (this.scriptpubkey === vout.scriptpubkey)) {
        this.unfundTxo(vout.value);
      }
    }
    this.tx_count--;
  }

  private fundTxo(value: number): void {
    this.funded_txo_sum += value;
    this.funded_txo_count++;
  }

  private unfundTxo(value: number): void {
    this.funded_txo_sum -= value;
    this.funded_txo_count--;
  }

  private spendTxo(value: number): void {
    this.spent_txo_sum += value;
    this.spent_txo_count++;
  }

  private unspendTxo(value: number): void {
    this.spent_txo_sum -= value;
    this.spent_txo_count--;
  }

  get balance(): number {
    return this.funded_txo_sum - this.spent_txo_sum;
  }

  get totalReceived(): number {
    return this.funded_txo_sum;
  }

  get utxos(): number {
    return this.funded_txo_count - this.spent_txo_count;
  }
}

@Component({
  selector: 'app-address',
  templateUrl: './address.component.html',
  styleUrls: ['./address.component.scss'],
  standalone: false,
})
export class AddressComponent implements OnInit, OnDestroy {
  mobileOverview = walletOverview;
  network = '';
  showWalletFiat = true;
  visibleWalletTransactions = 10;
  walletHistoryPage = 0;
  walletWatching = false;
  walletWatchIncoming = true;
  walletWatchOutgoing = true;
  walletWatchConfirmed = true;
  walletWatchMessage = '';
  walletWatchTxid = '';
  private walletNotified = new Set<string>();
  get pendingWalletTransactions(): Transaction[] { return (this.transactions || []).filter(tx => !tx.status.confirmed).slice(0,5); }
  setWalletPageSize(value: string): void {
    const size = Number(value);
    this.visibleWalletTransactions = [10,25,50].includes(size) ? size : 10;
    this.walletHistoryPage = 0; this.showWalletRaw = false; this.goWalletPage(0);
  }
  private goWalletPage(page: number): void {
    const loaded = this.transactions?.length || 0;
    const start = page * this.visibleWalletTransactions;
    const end = start + this.visibleWalletTransactions;
    const total = (this.chainStats?.tx_count || 0) + (this.mempoolStats?.tx_count || 0);
    if (!this.fullyLoaded && loaded < end && loaded < total && !this.isLoadingTransactions) {
      this.loadMore(() => this.goWalletPage(page));
    } else if (start < loaded || page === 0) { this.walletHistoryPage = page; this.showWalletRaw = false; }
  }
  nextWalletPage(): void { this.goWalletPage(this.walletHistoryPage+1); }
  previousWalletPage(): void { this.walletHistoryPage = Math.max(0,this.walletHistoryPage-1); this.showWalletRaw = false; }
  startWalletWatch(): void { this.walletWatching = true; this.walletNotified.clear(); this.walletWatchMessage = 'Watching new activity while this address page is open and connected.'; }
  stopWalletWatch(): void { this.walletWatching = false; this.walletWatchMessage = 'Address tracking stopped.'; }
  async enableWalletDesktopAlerts(): Promise<void> {
    if (typeof Notification === 'undefined') { this.walletWatchMessage = 'Desktop alerts are unavailable here. In-page tracking remains available.'; return; }
    try { const permission = await Notification.requestPermission(); this.walletWatchMessage = permission === 'granted' ? 'Desktop alerts enabled while this address page stays open and connected.' : 'Desktop permission was not granted. In-page tracking remains available.'; }
    catch { this.walletWatchMessage = 'Desktop alerts could not be enabled. In-page tracking remains available.'; }
  }
  private walletActivityAlert(tx: Transaction, confirmed: boolean): void {
    if (!this.walletWatching || !this.showWalletSnapshot) return;
    const spent = tx.vin?.some(v => v.prevout?.scriptpubkey_address === this.addressString);
    const received = tx.vout?.some(v => v.scriptpubkey_address === this.addressString);
    if (!spent && !received) return;
    if (confirmed ? !this.walletWatchConfirmed : spent ? !this.walletWatchOutgoing : !this.walletWatchIncoming) return;
    const key = tx.txid + (confirmed ? ':confirmed' : ':pending');
    if (this.walletNotified.has(key)) return;
    this.walletNotified.add(key); if (this.walletNotified.size > 100) this.walletNotified.delete(this.walletNotified.values().next().value);
    this.walletWatchTxid = tx.txid;
    this.walletWatchMessage = confirmed ? 'A transaction involving this address has confirmed. Open it to check confirmations and receiving-platform requirements.' : spent ? 'New pending spending from this address was observed. Open the transaction to inspect recipients, change and fees.' : 'New pending outputs to this address were observed. Open the transaction to check its amount and confirmation status.';
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try { new Notification('Bitcoin address activity', {body:this.walletWatchMessage,tag:key}); } catch { /* The in-page alert remains visible. */ }
    }
  }

  showWalletRaw = false;
  private walletHistorySource: Transaction[];
  private walletHistoryLimit = 0;
  private walletHistoryPageCache = -1;
  private walletHistoryCache: Transaction[] = [];
  get walletView() { return walletView(this.chainStats || this.address?.chain_stats, this.mempoolStats || this.address?.mempool_stats); }
  walletTxChange(tx: Transaction): number | null { return addressTransactionChange(tx, this.addressString); }
  get visibleWalletHistory(): Transaction[] {
    if (this.walletHistorySource !== this.transactions || this.walletHistoryLimit !== this.visibleWalletTransactions || this.walletHistoryPageCache !== this.walletHistoryPage) {
      this.walletHistorySource = this.transactions;
      this.walletHistoryLimit = this.visibleWalletTransactions;
      this.walletHistoryPageCache = this.walletHistoryPage;
      const start = this.walletHistoryPage * this.visibleWalletTransactions;
      this.walletHistoryCache = (this.transactions || []).slice(start,start+this.visibleWalletTransactions);
    }
    return this.walletHistoryCache;
  }



  isMobile: boolean;
  showQR: boolean = false;
  officialMempoolSpace = this.stateService.env.OFFICIAL_MEMPOOL_SPACE;

  address: Address;
  addressString: string;
  isLoadingAddress = true;
  transactions: Transaction[];
  utxos: Utxo[];
  isLoadingTransactions = true;
  retryLoadMore = false;
  error: any;
  mainSubscription: Subscription;
  mempoolTxSubscription: Subscription;
  mempoolRemovedTxSubscription: Subscription;
  blockTxSubscription: Subscription;
  fragmentSubscription: Subscription;
  networkChangeSubscription: Subscription;
  taprootFragment: URLSearchParams;
  addressLoadingStatus$: Observable<number>;
  addressInfo: null | AddressInformation = null;
  addressTypeInfo: null | AddressTypeInfo;
  tapTreeIncomplete: boolean = false;
  taprootPsbtExpanded: boolean = false;
  psbtForm: UntypedFormGroup;
  psbtError?: string;
  accelerationsSubscription: Subscription;
  acceleratedTxids: Set<string> | null = null;

  fullyLoaded = false;
  chainStats: AddressStats;
  mempoolStats: AddressStats;

  exampleChannel?: any;

  now = Date.now() / 1000;
  balancePeriod: 'all' | '1m' = 'all';

  private tempTransactions: Transaction[];
  private timeTxIndexes: number[];
  private lastTransactionTxId: string;

  constructor(
    private route: ActivatedRoute,
    private electrsApiService: ElectrsApiService,
    private websocketService: WebsocketService,
    public stateService: StateService,
    private audioService: AudioService,
    private apiService: ApiService,
    private seoService: SeoService,
    private formBuilder: UntypedFormBuilder,
  ) { }

  get showWalletSnapshot(): boolean {
    return !!this.stateService.env.PENDING_TRACKER_EXPLANATIONS && this.network === '';
  }


  mobileHelpOpen = false;
  mobileQuestionsExpanded = false;
  private positionOpenMobilePopover(panel: HTMLElement, trigger: HTMLButtonElement): void {
    const viewportHeight = window.visualViewport?.height || window.innerHeight;
    const rect = trigger.getBoundingClientRect();
    const anchor = trigger.closest('.pt-network-fact, .pt-wallet-fact, .pt-compact-fees, .pt-summary-actionbar, .pt-mobile-help-toolbar')?.getBoundingClientRect() || rect;
    const viewportWidth = document.documentElement.clientWidth;
    const width = Math.min(Math.max(anchor.width, 260), viewportWidth - 24);
    const left = Math.max(12, Math.min(anchor.left, viewportWidth - width - 12));
    const anchorBottom = (panel.id === 'pt-mobile-help' || panel.id === 'pt-network-help' || panel.id === 'pt-wallet-help') ? anchor.bottom : rect.bottom;
    const top = Math.max(8, Math.min(anchorBottom + 8, viewportHeight - 160));
    const pointer = Math.max(16, Math.min(width - 20, rect.left + rect.width / 2 - left));
    panel.style.setProperty('--pt-popover-top', top + 'px');
    panel.style.setProperty('--pt-popover-left', left + 'px');
    panel.style.setProperty('--pt-popover-width', width + 'px');
    panel.style.setProperty('--pt-popover-height', Math.max(120, Math.min(420, viewportHeight - top - 76)) + 'px');
    panel.style.setProperty('--pt-popover-pointer-x', pointer + 'px');
  }
  onMobileHelpQuestionToggle(event: Event): void {
    revealMobileHelpAnswer(event);
  }
  positionMobilePopover(event: Event): void {
    if (window.innerWidth > 767.98) return;
    const panel = event.target as HTMLElement;
    if ((event as Event & {newState?: string}).newState !== 'open') {
      if (['pt-mobile-help', 'pt-network-help', 'pt-wallet-help'].includes(panel.id)) {
        panel.querySelectorAll<HTMLDetailsElement>('details[open]').forEach(detail => detail.open = false);
        panel.scrollTop = 0;
      }
      return;
    }
    const trigger = Array.from(document.querySelectorAll<HTMLButtonElement>('#pt-network-layout button[popovertarget], #pt-wallet-layout button[popovertarget]'))
      .find(button => button.getAttribute('popovertarget') === panel.id && button.getAttribute('popovertargetaction') !== 'hide' && button.getClientRects().length > 0);
    if (!trigger) return;
    panel.classList.add('pt-anchored-mobile-popover');
    requestAnimationFrame(() => {
      if (!panel.matches(':popover-open')) return;
      this.positionOpenMobilePopover(panel, trigger);
      const viewportHeight = window.visualViewport?.height || window.innerHeight;
      const anchor = trigger.closest('.pt-mobile-help-toolbar')?.getBoundingClientRect() || trigger.getBoundingClientRect();
      const desiredHeight = mobilePopoverVisibleHeight(panel, viewportHeight);
      const availableBelow = viewportHeight - 76 - anchor.bottom - 8;
      if (availableBelow < desiredHeight) {
        const safeTop = 120;
        const availableScroll = Math.max(0, anchor.top - safeTop);
        const distance = Math.min(desiredHeight - availableBelow, availableScroll);
        if (distance > 0) window.scrollBy({top: distance, behavior:'auto'});
      }
      requestAnimationFrame(() => {
        if (panel.matches(':popover-open')) this.positionOpenMobilePopover(panel, trigger);
      });
    });
  }
  @HostListener('window:scroll')
  repositionMobileExplanationsOnPageScroll(): void {
    if (window.innerWidth > 767.98) return;
    document.querySelectorAll<HTMLElement>('#pt-network-layout .pt-anchored-mobile-popover:popover-open, #pt-wallet-layout .pt-anchored-mobile-popover:popover-open').forEach(panel => {
      const trigger = Array.from(document.querySelectorAll<HTMLButtonElement>('#pt-network-layout button[popovertarget], #pt-wallet-layout button[popovertarget]'))
        .find(button => button.getAttribute('popovertarget') === panel.id && button.getAttribute('popovertargetaction') !== 'hide' && button.getClientRects().length > 0);
      if (trigger) this.positionOpenMobilePopover(panel, trigger);
    });
  }

  mobileQuestionLabel(id: string): string {
    return ({busy:'How busy?',timing:'Timing',visuals:'The visuals',arrived:'My payment?',missing:'My balance?',spend:'Use funds?'} as Record<string,string>)[id] || id;
  }
  mobileMetricLabel(label: string): string {
    return ({'Example payment fee':'Example fee','Confirmation targets':'Target','Awaiting confirmation':'Waiting','Confirmed balance':'Balance','Pending balance':'Pending','Incoming (pending)':'Pending in','Pending transactions':'Pending txs','Outputs being spent':'Being spent','Net balance change':'Net pending','Balance after confirmation':'After confirmation','Total transactions':'Transactions'} as Record<string,string>)[label] || label;
  }

  readonly exampleId$ = this.route.queryParamMap.pipe(map(params => params.get('example')));
  focusOwnLookup(): void {
    window.scrollTo({top:0, behavior:'auto'});
    this.stateService.searchFocus$.next(true);
  }
  ngOnInit(): void {
    this.network = this.stateService.network;
    this.networkChangeSubscription = this.stateService.networkChanged$.subscribe((network) => {
      this.network = network;
      this.updateAccelerationSubscription();
    });
    this.websocketService.want(['blocks']);
    this.psbtForm = this.formBuilder.group({ psbt: [''], tapleaf: [''], taptree: [''], ikey: [''] });

    this.onResize();
    this.fragmentSubscription = this.route.fragment.subscribe((fragment) => {
      if (fragment) {
        this.taprootFragment = new URLSearchParams(fragment.replace(/\+/g, '%2B')); // URLSearchParams decodes "+" as space, so normalize to preserve base64 fragments
        this.submitPsbt();
      } else {
        this.taprootFragment = undefined;
      }
    });

    this.addressLoadingStatus$ = this.route.paramMap
      .pipe(
        switchMap(() => this.stateService.loadingIndicators$),
        map((indicators) => indicators['address-' + this.addressString] !== undefined ? indicators['address-' + this.addressString] : 0)
      );

    this.updateAccelerationSubscription();

    this.mainSubscription = this.route.paramMap
      .pipe(
        switchMap((params: ParamMap) => {
          this.visibleWalletTransactions = 10;
          this.walletHistoryPage = 0;
          this.walletWatching = false;
          this.walletWatchMessage = '';
          this.walletWatchTxid = '';
          this.showWalletRaw = false;
          this.chainStats = undefined;
          this.mempoolStats = undefined;
          this.error = undefined;
          this.isLoadingAddress = true;
          this.fullyLoaded = false;
          this.address = null;
          this.isLoadingTransactions = true;
          this.transactions = null;
          this.utxos = null;
          this.addressInfo = null;
          this.exampleChannel = null;
          this.tapTreeIncomplete = false;
          this.taprootPsbtExpanded = false;
          this.psbtForm?.reset({ psbt: '', tapleaf: '', taptree: '', ikey: '' });
          this.psbtError = undefined;
          document.body.scrollTo(0, 0);
          this.addressString = params.get('id') || '';
          if (/^[A-Z]{2,5}1[AC-HJ-NP-Z02-9]{8,100}|04[a-fA-F0-9]{128}|(02|03)[a-fA-F0-9]{64}$/.test(this.addressString)) {
            this.addressString = this.addressString.toLowerCase();
          }
          this.seoService.setTitle($localize`:@@address.component.browser-title:Address: ${this.addressString}:INTERPOLATION:`);
          this.seoService.setDescription($localize`:@@meta.description.bitcoin.address:See mempool transactions, confirmed transactions, balance, and more for ${this.stateService.network==='liquid'||this.stateService.network==='liquidtestnet'?'Liquid':'Bitcoin'}${seoDescriptionNetwork(this.stateService.network)} address ${this.addressString}:INTERPOLATION:.`);

          this.addressTypeInfo = new AddressTypeInfo(this.stateService.network || 'mainnet', this.addressString);

          return merge(
            of(true),
            this.stateService.connectionState$
              .pipe(filter((state) => state === 2 && this.transactions && this.transactions.length > 0))
          )
          .pipe(
            switchMap(() => (
              this.addressString.match(/04[a-fA-F0-9]{128}|(02|03)[a-fA-F0-9]{64}/)
              ? this.electrsApiService.getPubKeyAddress$(this.addressString)
              : this.electrsApiService.getAddress$(this.addressString)
            ).pipe(
                catchError((err) => {
                  this.isLoadingAddress = false;
                  this.error = err;
                  this.seoService.logSoft404();
                  console.log(err);
                  return of(null);
                })
              )
            )
          );
        })
      )
      .pipe(
        filter((address) => !!address),
        tap((address: Address) => {
          if ((this.stateService.network === 'liquid' || this.stateService.network === 'liquidtestnet') && /^([a-zA-HJ-NP-Z1-9]{26,35}|[a-z]{2,5}1[ac-hj-np-z02-9]{8,100}|[a-km-zA-HJ-NP-Z1-9]{80})$/.test(address.address)) {
            this.apiService.validateAddress$(address.address)
              .subscribe((addressInfo) => {
                this.addressInfo = addressInfo;
                this.websocketService.startTrackAddress(addressInfo.unconfidential);
              });
          } else {
            this.websocketService.startTrackAddress(address.address);
          }
        }),
        switchMap((address) => {
          this.address = address;
          this.updateChainStats();
          this.isLoadingAddress = false;
          this.isLoadingTransactions = true;
          const utxoCount = this.chainStats.utxos + this.mempoolStats.utxos;
          return forkJoin([
            address.is_pubkey
              ? this.electrsApiService.getScriptHashTransactions$((address.address.length === 66 ? '21' : '41') + address.address + 'ac')
              : this.electrsApiService.getAddressTransactions$(address.address),
            (utxoCount > 2 && utxoCount <= 500 ? (address.is_pubkey
              ? this.electrsApiService.getScriptHashUtxos$((address.address.length === 66 ? '21' : '41') + address.address + 'ac')
              : this.electrsApiService.getAddressUtxos$(address.address)) : of(null)).pipe(
                catchError(() => {
                  return of(null);
                })
              )
          ]);
        }),
        switchMap(([transactions, utxos]) => {
          this.utxos = utxos;

          this.tempTransactions = transactions;
          if (transactions.length) {
            this.lastTransactionTxId = transactions[transactions.length - 1].txid;
          }

          const fetchTxs: string[] = [];
          this.timeTxIndexes = [];
          transactions.forEach((tx, index) => {
            if (!tx.status.confirmed) {
              fetchTxs.push(tx.txid);
              this.timeTxIndexes.push(index);
            }
          });
          if (!fetchTxs.length) {
            return of([]);
          }
          return this.apiService.getTransactionTimes$(fetchTxs).pipe(
            catchError((err) => {
              this.isLoadingAddress = false;
              this.isLoadingTransactions = false;
              this.error = err;
              this.seoService.logSoft404();
              console.log(err);
              return of([]);
            })
          );
        })
      )
      .subscribe((times: number[] | null) => {
        if (!times) {
          return;
        }
        times.forEach((time, index) => {
          this.tempTransactions[this.timeTxIndexes[index]].firstSeen = time;
        });
        this.tempTransactions.sort((a, b) => {
          if (b.status.confirmed) {
            if (b.status.block_height === a.status.block_height) {
              return b.status.block_time - a.status.block_time;
            }
            return b.status.block_height - a.status.block_height;
          }
          return b.firstSeen - a.firstSeen;
        });

        this.transactions = this.tempTransactions;
        if (this.transactions.length === (this.mempoolStats.tx_count + this.chainStats.tx_count)) {
          this.fullyLoaded = true;
        }
        this.isLoadingTransactions = false;

        const addressVin: Vin[] = [];
        const vinIds: string[] = [];
        for (const tx of this.transactions) {
          tx.vin.forEach((v, index) => {
            if (v.prevout?.scriptpubkey_address === this.address.address) {
              addressVin.push(v);
              vinIds.push(`${tx.txid}:${index}`);
            }
          });
        }
        this.addressTypeInfo.processInputs(addressVin, vinIds);
        if (this.addressTypeInfo.type === 'v1_p2tr' && !this.addressTypeInfo.tapscript) {
          this.setTapTreeIncomplete(true);
        }
        // hack to trigger change detection
        this.addressTypeInfo = this.addressTypeInfo.clone();

        if (!this.showBalancePeriod()) {
          this.setBalancePeriod('all');
        } else {
          this.setBalancePeriod('1m');
        }
      },
      (error) => {
        console.log(error);
        this.error = error;
        this.seoService.logSoft404();
        this.isLoadingAddress = false;
      });

    this.mempoolTxSubscription = this.stateService.mempoolTransactions$
      .subscribe(tx => {
        this.walletActivityAlert(tx,false);
        this.addTransaction(tx);
        this.mempoolStats.addTx(tx);
      });

    this.mempoolRemovedTxSubscription = this.stateService.mempoolRemovedTransactions$
      .subscribe(tx => {
        this.removeTransaction(tx);
        this.mempoolStats.removeTx(tx);
      });

    this.blockTxSubscription = this.stateService.blockTransactions$
      .subscribe((transaction) => {
        this.walletActivityAlert(transaction,true);
        const tx = this.transactions.find((t) => t.txid === transaction.txid);
        if (tx) {
          tx.status = transaction.status;
          this.transactions = this.transactions.slice();
          this.mempoolStats.removeTx(transaction);
          this.audioService.playSound('magic');
          this.confirmTransaction(tx);
        } else {
          if (this.addTransaction(transaction, false)) {
            this.audioService.playSound('magic');
          }
        }
        this.chainStats.addTx(transaction);
      });
  }

  addTransaction(transaction: Transaction, playSound: boolean = true): boolean {
    if (this.transactions.some((t) => t.txid === transaction.txid)) {
      return false;
    }

    this.transactions.unshift(transaction);
    this.transactions = this.transactions.slice();

    if (playSound) {
      if (transaction.vout.some((vout) => vout?.scriptpubkey_address === this.address.address)) {
        this.audioService.playSound('cha-ching');
      } else {
        this.audioService.playSound('chime');
      }
    }

    // update utxos in-place
    if (this.utxos != null) {
      let utxosChanged = false;
      for (const vin of transaction.vin) {
        const utxoIndex = this.utxos.findIndex((utxo) => utxo.txid === vin.txid && utxo.vout === vin.vout);
        if (utxoIndex !== -1) {
          this.utxos.splice(utxoIndex, 1);
          utxosChanged = true;
        }
      }
      for (const [index, vout] of transaction.vout.entries()) {
        if (vout.scriptpubkey_address === this.address.address) {
          this.utxos.push({
            txid: transaction.txid,
            vout: index,
            value: vout.value,
            status: JSON.parse(JSON.stringify(transaction.status)),
          });
          utxosChanged = true;
        }
      }
      if (utxosChanged) {
        this.utxos = this.utxos.slice();
      }
    }
    return true;
  }

  removeTransaction(transaction: Transaction): boolean {
    const index = this.transactions.findIndex(((tx) => tx.txid === transaction.txid));
    if (index === -1) {
      return false;
    }

    this.transactions.splice(index, 1);
    this.transactions = this.transactions.slice();

    // update utxos in-place
    if (this.utxos != null) {
      let utxosChanged = false;
      for (const vin of transaction.vin) {
        if (vin.prevout?.scriptpubkey_address === this.address.address) {
          this.utxos.push({
            txid: vin.txid,
            vout: vin.vout,
            value: vin.prevout.value,
            status: { confirmed: true }, // Assuming the input was confirmed
          });
          utxosChanged = true;
        }
      }
      for (const [index, vout] of transaction.vout.entries()) {
        if (vout.scriptpubkey_address === this.address.address) {
          const utxoIndex = this.utxos.findIndex((utxo) => utxo.txid === transaction.txid && utxo.vout === index);
          if (utxoIndex !== -1) {
            this.utxos.splice(utxoIndex, 1);
            utxosChanged = true;
          }
        }
      }
      if (utxosChanged) {
        this.utxos = this.utxos.slice();
      }
    }

    return true;
  }

  confirmTransaction(transaction: Transaction): void {
    // update utxos in-place
    if (this.utxos != null) {
      let utxosChanged = false;
      for (const vin of transaction.vin) {
        if (vin.prevout?.scriptpubkey_address === this.address.address) {
          const utxoIndex = this.utxos.findIndex((utxo) => utxo.txid === vin.txid && utxo.vout === vin.vout);
          if (utxoIndex !== -1) {
            this.utxos[utxoIndex].status = JSON.parse(JSON.stringify(transaction.status));
            utxosChanged = true;
          }
        }
      }
      for (const [index, vout] of transaction.vout.entries()) {
        if (vout.scriptpubkey_address === this.address.address) {
          const utxoIndex = this.utxos.findIndex((utxo) => utxo.txid === transaction.txid && utxo.vout === index);
          if (utxoIndex !== -1) {
            this.utxos[utxoIndex].status = JSON.parse(JSON.stringify(transaction.status));
            utxosChanged = true;
          }
        }
      }
      if (utxosChanged) {
        this.utxos = this.utxos.slice();
      }
    }
  }

  loadMore(afterLoad?: () => void): void {
    if (this.isLoadingTransactions || this.fullyLoaded) {
      return;
    }
    this.isLoadingTransactions = true;
    this.retryLoadMore = false;
    (this.address.is_pubkey
    ? this.electrsApiService.getScriptHashTransactions$((this.address.address.length === 66 ? '21' : '41') + this.address.address + 'ac', this.lastTransactionTxId)
    : this.electrsApiService.getAddressTransactions$(this.address.address, this.lastTransactionTxId))
      .subscribe((transactions: Transaction[]) => {
        if (transactions && transactions.length) {
          this.lastTransactionTxId = transactions[transactions.length - 1].txid;
          this.transactions = this.transactions.concat(transactions);
        } else {
          this.fullyLoaded = true;
        }
        this.isLoadingTransactions = false;
        if (afterLoad) afterLoad();
      },
      (error) => {
        this.isLoadingTransactions = false;
        this.retryLoadMore = true;
        // In the unlikely event of the txid wasn't found in the mempool anymore and we must reload the page.
        if (error.status === 422) {
          window.location.reload();
        }
      });
  }

  updateChainStats(): void {
    this.chainStats = new AddressStats(this.address.chain_stats, this.address.address);
    this.mempoolStats = new AddressStats(this.address.mempool_stats, this.address.address);
  }

  setBalancePeriod(period: 'all' | '1m'): boolean {
    this.balancePeriod = period;
    return false;
  }

  showBalancePeriod(): boolean {
    return this.transactions?.length && (
      !this.transactions[0].status?.confirmed
      || this.transactions[0].status.block_time > (this.now - (60 * 60 * 24 * 30))
    );
  }

  sanitizeFormControl(controlName: string): string {
    const control = this.psbtForm?.get(controlName);
    const sanitized = (control?.value || '').trim();
    if (control && control.value !== sanitized) {
      control.setValue(sanitized, { emitEvent: false });
    }
    return sanitized;
  }

  submitPsbt(): void {
    if (this.psbtForm && this.tapTreeIncomplete) {
      if (this.taprootFragment) { // If pending fragment, apply it first
        const fragment = this.taprootFragment;
        this.taprootFragment = undefined;

        const patch = {};
        ['psbt', 'tapleaf', 'taptree', 'ikey'].forEach((key) => {
          const value = fragment.get(key);
          if (value) {
            patch[key] = value;
          }
        });

        if (Object.keys(patch).length) {
          this.psbtForm.patchValue(patch, { emitEvent: false });
        }
      }

      try {
        const psbt = this.sanitizeFormControl('psbt');
        const tapleavesRaw = this.sanitizeFormControl('tapleaf');
        const taptree = this.sanitizeFormControl('taptree');
        const internalKey = this.sanitizeFormControl('ikey');
        const tapleaves = tapleavesRaw ? tapleavesRaw.split(',').map((leaf) => leaf.trim()).filter(Boolean) : [];

        const hasInput = !!(psbt || tapleaves.length || taptree);
        if (!hasInput) {
          this.psbtError = undefined;
          return;
        }

        const psbtBuffer = psbt ? convertTextToBuffer(psbt) : undefined;
        const tapleafRecords = tapleaves.reduce((records, leaf) => {
          const parts = leaf.split(':');
          if (parts.length !== 2 || !parts[0] || !parts[1]) {
            throw new Error('Tapleaves must be in the format "<control block>:<script><leaf version>" separated by commas');
          }
          records.push({
            keyData: convertTextToBuffer(parts[0]),
            value: convertTextToBuffer(parts[1]),
          });
          return records;
        }, [] as PsbtKeyValue[]);
        const taptreeBuffer = taptree ? convertTextToBuffer(taptree) : undefined;
        const internalKeyBuffer = internalKey ? convertTextToBuffer(internalKey) : undefined;

        const leaves = extractTapLeaves(psbtBuffer, tapleafRecords, taptreeBuffer, internalKeyBuffer);
        fillTapTree(this.addressTypeInfo, leaves);
        this.addressTypeInfo = this.addressTypeInfo.clone();
        this.psbtForm?.reset({ psbt: '', tapleaf: '', taptree: '', ikey: '' });
        this.psbtError = undefined;
      } catch (error) {
        this.taprootPsbtExpanded = true;
        if (error instanceof Error) {
          this.psbtError = error.message;
        } else {
          this.psbtError = 'An error occurred while processing taproot data';
        }
      }
    }
  }

  setTapTreeIncomplete(incomplete: boolean): void {
    if (!incomplete) {
      this.taprootPsbtExpanded = false;
    }
    this.tapTreeIncomplete = incomplete;
    if (this.taprootFragment) {
      this.submitPsbt();
    }
  }

  showTaprootPsbtButton(): boolean {
    const isBitcoin = this.stateService.network !== 'liquid' && this.stateService.network !== 'liquidtestnet';
    return this.addressTypeInfo?.type === 'v1_p2tr' && isBitcoin && this.tapTreeIncomplete;
  }

  @HostListener('window:resize', ['$event'])
  onResize(): void {
    this.isMobile = window.innerWidth < 768;
  }

  private updateAccelerationSubscription(): void {
    if (this.stateService.env.ACCELERATOR_BUTTON && this.network === '') {
      if (!this.accelerationsSubscription) {
        this.websocketService.ensureTrackAccelerations();
        this.acceleratedTxids = new Set();
        this.accelerationsSubscription = this.stateService.accelerations$.subscribe((delta) => {
          if (!this.acceleratedTxids) {
            this.acceleratedTxids = new Set();
          }
          if (delta.reset) {
            this.acceleratedTxids.clear();
          } else {
            for (const txid of delta.removed) {
              this.acceleratedTxids.delete(txid);
            }
          }
          for (const acceleration of delta.added) {
            this.acceleratedTxids.add(acceleration.txid);
          }
        });
      }
    } else {
      this.accelerationsSubscription?.unsubscribe();
      this.accelerationsSubscription = null;
      this.acceleratedTxids = null;
    }
  }

  ngOnDestroy(): void {
    this.mainSubscription.unsubscribe();
    this.mempoolTxSubscription.unsubscribe();
    this.mempoolRemovedTxSubscription.unsubscribe();
    this.blockTxSubscription.unsubscribe();
    this.websocketService.stopTrackingAddress();
    this.fragmentSubscription?.unsubscribe();
    this.networkChangeSubscription?.unsubscribe();
    this.accelerationsSubscription?.unsubscribe();
    this.websocketService.stopTrackAccelerations();
  }
}
