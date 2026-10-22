import { Component, OnInit, OnDestroy, Input, ViewChild } from '@angular/core';
import { Router } from '@angular/router';
import { Env, StateService } from '@app/services/state.service';
import { Observable, merge, of, Subscription, firstValueFrom, timeout } from 'rxjs';
import { ElectrsApiService } from '@app/services/electrs-api.service';
import { LanguageService } from '@app/services/language.service';
import { EnterpriseService } from '@app/services/enterprise.service';
import { NavigationService } from '@app/services/navigation.service';
import { MenuComponent } from '@components/menu/menu.component';
import { StorageService } from '@app/services/storage.service';
import { AuthServiceMempool } from '@app/services/auth.service';

@Component({
  selector: 'app-master-page',
  templateUrl: './master-page.component.html',
  styleUrls: ['./master-page.component.scss'],
  standalone: false,
})
export class MasterPageComponent implements OnInit, OnDestroy {
  @Input() headerVisible = true;
  @Input() footerVisibleOverride: boolean | null = null;

  focusLookup(): void {
    this.lookupError = '';
    this.stateService.searchFocus$.next(true);
  }

  lookupLoading = false;
  lookupError = '';
  // Public large-address selection: ChainQuery rich-list snapshot, 2026-10-18.
  // https://chainquery.com/lists/rich-list — addresses only; no ownership claims.
  private readonly lookupAddresses = [
    '34xp4vRoCGJym3xR7yCVPFHoCNxv4Twseo',
    '3M219KR5vEneNb47ewrPfWyb5jQ2DjxRP6',
    'bc1ql49ydapnjafl5t2cp9zqpjwe6pdgmxy98859v2',
    'bc1qgdjqv0av3q56jvd82tkdjpy7gdp9ut8tlqmgrpmv24sq90ecnvqqjwvw97',
    'bc1qjasf9z3h7w3jspkhtgatgpyvvzgpa2wwd2lr0eh5tx44reyn2k7sfc27a4',
    'bc1qazcm763858nkj2dj986etajv6wquslv8uxwczt',
    'bc1qd4ysezhmypwty5dnw7c8nqy5h5nxg0xqsvaefd0qn5kq32vwnwqqgv4rzr',
    '1FeexV6bAHb8ybZjqQMjJrcCrHGW9sb6uF',
    'bc1q8yj0herd4r4yxszw3nkfvt53433thk0f5qst4g',
    '1Ay8vMC7R1UbyCCZRVULMV7iQpHSAbguJP'
  ];
  private lookupAddressIndex = -1;
  async openRecentTransaction(): Promise<void> {
    if (this.lookupLoading) return;
    this.lookupLoading = true;
    this.lookupError = '';
    try {
      const recent = await firstValueFrom(this.electrsApiService.getRecentTransaction$().pipe(timeout(8000)));
      for (const candidate of recent.slice(0, 5)) {
        try {
          const tx = await firstValueFrom(this.electrsApiService.getTransaction$(candidate.txid).pipe(timeout(4000)));
          if (!tx.status.confirmed) {
            await this.router.navigate(['/tx', tx.txid]);
            this.collapse();
            return;
          }
        } catch { /* A recent transaction may have been replaced or dropped. */ }
      }
      this.lookupError = 'No recent pending transaction is available. Paste your transaction ID into search or try again.';
    } catch {
      this.lookupError = 'Recent transactions are unavailable. Paste your transaction ID into search or try again.';
    } finally { this.lookupLoading = false; }
  }
  openPublicWallet(): void {
    this.lookupError = '';
    this.lookupAddressIndex = this.lookupAddressIndex < 0 ? Math.floor(Math.random() * this.lookupAddresses.length) : (this.lookupAddressIndex + 1) % this.lookupAddresses.length;
    this.router.navigate(['/address', this.lookupAddresses[this.lookupAddressIndex]]);
    this.collapse();
  }

  reviewTools = [
    { label: 'Blocks', path: '/blocks' },
    { label: 'Charts', path: '/graphs' },
    { label: 'Mining', path: '/mining' },
    { label: 'Lightning', path: '/lightning' },
    { label: 'API Docs', path: '/docs' },
    { label: 'About', path: '/about' },
  ];

  env: Env;
  network$: Observable<string>;
  connectionState$: Observable<number>;
  navCollapsed = false;
  isMobile = window.innerWidth <= 767.98;
  officialMempoolSpace = this.stateService.env.OFFICIAL_MEMPOOL_SPACE;
  officialMempoolSpaceBuild = this.stateService.isMempoolSpaceBuild;
  urlLanguage: string;
  subdomain = '';
  networkPaths: { [network: string]: string };
  networkPaths$: Observable<Record<string, string>>;
  footerVisible = true;
  user: any = undefined;
  servicesEnabled = false;
  menuOpen = false;
  isDropdownVisible: boolean;

  enterpriseInfo: any;
  enterpriseInfo$: Subscription;
  authSubscription$: Subscription;

  @ViewChild(MenuComponent)
  public menuComponent!: MenuComponent;

  constructor(
    public stateService: StateService,
    private languageService: LanguageService,
    private enterpriseService: EnterpriseService,
    private navigationService: NavigationService,
    private storageService: StorageService,
    private authService: AuthServiceMempool,
    private router: Router,
    private electrsApiService: ElectrsApiService,
  ) { }

  ngOnInit(): void {
    this.env = this.stateService.env;
    this.connectionState$ = this.stateService.connectionState$;
    this.network$ = merge(of(''), this.stateService.networkChanged$);
    this.urlLanguage = this.languageService.getLanguageForUrl();
    this.subdomain = this.enterpriseService.getSubdomain();
    this.navigationService.subnetPaths.subscribe((paths) => {
      this.networkPaths = paths;
      if (this.footerVisibleOverride === null) {
        if (paths.mainnet.indexOf('docs') > -1) {
          this.footerVisible = false;
        } else {
          this.footerVisible = true;
        }
      } else {
        this.footerVisible = this.footerVisibleOverride;
      }
    });
    this.enterpriseInfo$ = this.enterpriseService.info$.subscribe(info => {
      this.enterpriseInfo = info;
    });

    this.servicesEnabled = this.officialMempoolSpace && this.stateService.env.ACCELERATOR === true && this.stateService.network === '';
    this.authSubscription$ = this.authService.getAuth$().subscribe((auth) => {
      this.user = auth?.user ?? null;
    });

    const isServicesPage = this.router.url.includes('/services/');
    this.menuOpen = isServicesPage && !this.isSmallScreen();
    this.setDropdownVisibility();
  }

  get networkDisplayName(): string {
    return this.stateService.networkDisplayName;
  }

  setDropdownVisibility(): void {
    const networks = [
      this.env.TESTNET_ENABLED,
      this.env.TESTNET4_ENABLED,
      this.env.SIGNET_ENABLED,
      this.env.REGTEST_ENABLED,
      this.env.LIQUID_ENABLED,
      this.env.LIQUID_TESTNET_ENABLED,
      this.env.MAINNET_ENABLED,
    ];
    const enabledNetworksCount = networks.filter((networkEnabled) => networkEnabled).length;
    this.isDropdownVisible = enabledNetworksCount > 1;
  }

  collapse(): void {
    this.navCollapsed = !this.navCollapsed;
  }

  isSmallScreen(): boolean {
    return window.innerWidth <= 767.98;
  }

  onResize(): void {
    this.isMobile = this.isSmallScreen();
  }

  brandClick(e): void {
    this.stateService.resetScroll$.next(true);
  }

  onLoggedOut(): void {
    this.refreshAuth();
  }

  refreshAuth(): void {
    this.user = this.storageService.getAuth()?.user ?? null;
  }

  hamburgerClick(event): void {
    if (this.menuComponent) {
      this.menuComponent.hamburgerClick();
      this.menuOpen = this.menuComponent.navOpen;
      event.stopPropagation();
    }
  }

  menuToggled(isOpen: boolean): void {
    this.menuOpen = isOpen;
  }

  ngOnDestroy(): void {
    if (this.enterpriseInfo$) {
      this.enterpriseInfo$.unsubscribe();
    }
    if (this.authSubscription$) {
      this.authSubscription$.unsubscribe();
    }
  }

}
