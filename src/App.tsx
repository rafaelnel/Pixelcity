import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Award,
  Building2,
  Compass,
  Hammer,
  Maximize2,
  Moon,
  RotateCw,
  Sun,
  Sunset,
  TrendingDown,
  TrendingUp,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { BudgetModal } from './components/BudgetModal';
import { EmergenciesModal } from './components/EmergenciesModal';
import { FinancesModal } from './components/FinancesModal';
import { NavMenu, type NavBadgeSpec } from './components/NavMenu';
import { NewsTicker } from './components/NewsTicker';
import { PauseModal } from './components/PauseModal';
import { ReportModal } from './components/ReportModal';
import { ReturnMenuModal } from './components/ReturnMenuModal';
import { SavesModal } from './components/SavesModal';
import { TitleOverlay } from './components/TitleOverlay';
import { TopHud } from './components/TopHud';
import {
  advanceSimulationTime,
  convertBuildingToCondo,
  createHudSnapshot,
  createNewCity,
  createParticlePool,
  cycleCitySeasonMode,
  deleteSavedCityFromStorage,
  demolishCityTile,
  deserializeCitySave,
  dismissMilestoneBanner,
  executeEmergencyAction,
  expandCityLand,
  formatDateLabel,
  getCondoConversionInfo,
  getNeighborhoodDistrict,
  getNeighborhoodDistrictLabel,
  getNeighborhoodMaturity,
  getRoadClassLabel,
  getTile,
  getZoneDisplayLabel,
  isDoubleWidthBridgeTile,
  isExternalBorderRoadTile,
  isTollPlazaTile,
  loadSavedCitiesFromStorage,
  sanitizeCityName,
  sanitizeDifficulty,
  saveCurrentCityToStorage,
  serializeCitySave,
  setCityBudget,
  setCityBudgetTargetPct,
  setCityDifficulty,
  setCityName,
  setCondoPolicy,
  setTaxRate,
  setTollTariff,
  updateBoatsAndPlanes,
  updateCarsAndParticles,
  type CitySaveRecord,
} from './game/cityEngine';
import {
  clampCamera,
  DEFAULT_ZOOM,
  MAX_ZOOM,
  MIN_ZOOM,
  screenToGrid,
  zoomCameraAtPoint,
} from './game/isoMath';
import {
  getAtmosphericGradientOverlay,
  getConstructionStageLabel,
  getTileConstructionStage,
  type TimeOfDayMode,
} from './game/pixelArtHelpers';
import { renderCityCanvas } from './game/pixelRenderer';
import {
  DEFAULT_DIFFICULTY,
  TOLL_TARIFF_CONFIGS,
  TOLL_TARIFF_ORDER,
  URBAN_MATURITY_CONFIG,
} from './game/simulationConfig';
import { soundEngine } from './game/soundEngine';
import type {
  AppScreenState,
  BoatEntity,
  BudgetAreaKey,
  CameraRotation,
  CameraState,
  CarEntity,
  CityState,
  CondoPolicy,
  DifficultyLevel,
  EmergencyActionId,
  ExpandDirection,
  HelicopterEntity,
  HudSnapshot,
  MapFilter,
  ModalTab,
  ParticleEntity,
  PlaneEntity,
  SimSpeed,
  TaxRates,
  TileType,
  TollTariffLevel,
} from './game/types';

const TILE_LABELS: Record<TileType, string> = {
  grass: 'Campo',
  forest: 'Floresta',
  water: 'Rio',
  road: 'Rua',
  bridge: 'Ponte',
  rural: 'Zona Rural',
  residential: 'Residencial',
  commercial: 'Comercial',
  industrial: 'Indústria',
  park: 'Parque',
  abandoned: 'Abandonado',
  port: 'Porto Fluvial',
  airport: 'Aeroporto',
  stadium: 'Estádio',
  bus_station: 'Terminal de Ônibus',
  metro_station: 'Estação de Metrô',
  shopping: 'Shopping Center',
};

function getInitialQueryParams(): {
  autostart: boolean;
  seed?: number;
  difficulty: DifficultyLevel;
} {
  if (typeof window === 'undefined') {
    return { autostart: false, difficulty: DEFAULT_DIFFICULTY };
  }
  const params = new URLSearchParams(window.location.search);
  const autostart = params.get('autostart') === '1';
  const rawSeed = params.get('seed');
  const parsedSeed = rawSeed ? Number.parseInt(rawSeed, 10) : NaN;
  const difficulty = sanitizeDifficulty(params.get('difficulty'));
  return {
    autostart,
    seed: Number.isFinite(parsedSeed) && parsedSeed > 0 ? parsedSeed : undefined,
    difficulty,
  };
}

export default function App() {
  const initialParams = useRef(getInitialQueryParams());

  // Mutable simulation state held outside React render cycle
  const cityRef = useRef<CityState | null>(null);
  if (!cityRef.current) {
    cityRef.current = createNewCity(
      initialParams.current.seed,
      initialParams.current.difficulty
    );
  }
  const carsRef = useRef<CarEntity[]>([]);
  const boatsRef = useRef<BoatEntity[]>([]);
  const planesRef = useRef<PlaneEntity[]>([]);
  const helicoptersRef = useRef<HelicopterEntity[]>([]);
  const particlesRef = useRef<ParticleEntity[]>(createParticlePool());
  const particleCursorRef = useRef<{ idx: number }>({ idx: 0 });

  // 3D Isometric Camera state (intact!)
  const cameraRef = useRef<CameraState>({
    panX: 0,
    panY: 0,
    zoom: DEFAULT_ZOOM,
    rotation: 0,
  });
  const [zoomUi, setZoomUi] = useState<number>(DEFAULT_ZOOM);
  const [rotationUi, setRotationUi] = useState<CameraRotation>(0);

  // Drag / pan & two-finger pinch-to-zoom gesture refs (strictly no finger rotation!)
  const activePointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchRef = useRef<{
    active: boolean;
    startDist: number;
    startZoom: number;
    prevMidX: number;
    prevMidY: number;
  }>({
    active: false,
    startDist: 0,
    startZoom: DEFAULT_ZOOM,
    prevMidX: 0,
    prevMidY: 0,
  });
  const dragRef = useRef<{
    active: boolean;
    moved: boolean;
    startX: number;
    startY: number;
    startPanX: number;
    startPanY: number;
  }>({
    active: false,
    moved: false,
    startX: 0,
    startY: 0,
    startPanX: 0,
    startPanY: 0,
  });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const keysHeldRef = useRef<Set<string>>(new Set());

  const [screenState, setScreenState] = useState<AppScreenState>(
    initialParams.current.autostart ? 'playing' : 'title'
  );
  const [selectedDifficulty, setSelectedDifficulty] = useState<DifficultyLevel>(
    initialParams.current.difficulty
  );
  const selectedDifficultyRef = useRef<DifficultyLevel>(selectedDifficulty);
  selectedDifficultyRef.current = selectedDifficulty;

  const [newCityName, setNewCityName] = useState<string>('Pixópolis');
  const newCityNameRef = useRef<string>(newCityName);
  newCityNameRef.current = newCityName;

  const [hud, setHud] = useState<HudSnapshot>(() =>
    createHudSnapshot(cityRef.current!)
  );
  const [speed, setSpeed] = useState<SimSpeed>(1);
  const lastNonZeroSpeedRef = useRef<SimSpeed>(1);
  const [mapFilter, setMapFilter] = useState<MapFilter>('normal');
  const [timeOfDay, setTimeOfDay] = useState<TimeOfDayMode>('auto');
  const [activeModal, setActiveModal] = useState<ModalTab | null>(null);
  const [savesModalOpen, setSavesModalOpen] = useState<boolean>(false);
  const [returnMenuOpen, setReturnMenuOpen] = useState<boolean>(false);
  const [savedGames, setSavedGames] = useState<CitySaveRecord[]>(() =>
    loadSavedCitiesFromStorage()
  );
  const [justSaved, setJustSaved] = useState<boolean>(false);
  const [saveToast, setSaveToast] = useState<string | null>(null);
  const saveFeedbackTimerRef = useRef<number | null>(null);
  const [savesFeedback, setSavesFeedback] = useState<string | null>(null);
  const [emergencyFeedback, setEmergencyFeedback] = useState<string | null>(null);
  const [hoveredInfo, setHoveredInfo] = useState<string | null>(null);
  const [muted, setMuted] = useState<boolean>(false);
  const [demolishMode, setDemolishMode] = useState<boolean>(false);
  const [selectedTileCoords, setSelectedTileCoords] = useState<{
    tx: number;
    ty: number;
  } | null>(null);
  const [demolishFeedback, setDemolishFeedback] = useState<string | null>(null);

  // Refs read by the Canvas render loop
  const screenStateRef = useRef<AppScreenState>(screenState);
  const speedRef = useRef<SimSpeed>(speed);
  const mapFilterRef = useRef<MapFilter>(mapFilter);
  const timeOfDayRef = useRef<TimeOfDayMode>(timeOfDay);
  const activeModalRef = useRef<ModalTab | null>(activeModal);
  const savesModalOpenRef = useRef<boolean>(savesModalOpen);
  const returnMenuOpenRef = useRef<boolean>(returnMenuOpen);
  const hoveredTileRef = useRef<{ tx: number; ty: number } | null>(null);

  screenStateRef.current = screenState;
  speedRef.current = speed;
  mapFilterRef.current = mapFilter;
  timeOfDayRef.current = timeOfDay;
  activeModalRef.current = activeModal;
  savesModalOpenRef.current = savesModalOpen;
  returnMenuOpenRef.current = returnMenuOpen;

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const lightingOverlayRef = useRef<HTMLDivElement | null>(null);
  const worldTimeSecRef = useRef<number>(0);
  const stageContainerRef = useRef<HTMLDivElement | null>(null);
  const stageSizeRef = useRef<{ w: number; h: number }>({ w: 1280, h: 800 });

  useEffect(() => {
    document.body.dataset.state = screenState;
  }, [screenState]);

  useEffect(() => {
    document.body.dataset.season = hud.weather.season;
    document.body.dataset.weather = hud.weather.kind;
  }, [hud.weather.season, hud.weather.kind]);

  const flushSounds = useCallback((state: CityState) => {
    if (state.pendingSounds.length === 0) return;
    const cues = state.pendingSounds.splice(0, state.pendingSounds.length);
    if (cues.some((c) => c.type === 'emergency')) {
      soundEngine.playEmergency();
    } else if (cues.some((c) => c.type === 'level3' || c.type === 'milestone')) {
      soundEngine.playLevel3();
    } else if (cues.some((c) => c.type === 'bridge')) {
      soundEngine.playBridge();
    } else if (cues.some((c) => c.type === 'decay')) {
      soundEngine.playDecay();
    } else if (cues.some((c) => c.type === 'monthClose')) {
      soundEngine.playMonthClose();
    }
  }, []);

  const syncHud = useCallback(() => {
    if (!cityRef.current) return;
    setHud(createHudSnapshot(cityRef.current));
  }, []);

  const applyCameraZoom = useCallback(
    (nextZoom: number, focalX?: number, focalY?: number) => {
      const { w, h } = stageSizeRef.current;
      const sx = focalX ?? w / 2;
      const sy = focalY ?? h / 2;
      const gw = cityRef.current?.gridWidth ?? 36;
      const gh = cityRef.current?.gridHeight ?? 36;
      const next = zoomCameraAtPoint(
        cameraRef.current,
        nextZoom,
        sx,
        sy,
        w,
        h,
        gw,
        gh
      );
      cameraRef.current = next;
      setZoomUi(next.zoom);
    },
    []
  );

  const handleZoomStep = useCallback(
    (factor: number) => {
      applyCameraZoom(cameraRef.current.zoom * factor);
      soundEngine.playSelect();
    },
    [applyCameraZoom]
  );

  const handleRotateCamera = useCallback((dir: 1 | -1 = 1) => {
    const cur = cameraRef.current;
    const nextRot = ((((cur.rotation + dir) % 4) + 4) % 4) as CameraRotation;
    cameraRef.current = {
      ...cur,
      rotation: nextRot,
    };
    setRotationUi(nextRot);
    soundEngine.playSelect();
  }, []);

  const handleResetCamera = useCallback(() => {
    cameraRef.current = {
      panX: 0,
      panY: 0,
      zoom: DEFAULT_ZOOM,
      rotation: 0,
    };
    setZoomUi(DEFAULT_ZOOM);
    setRotationUi(0);
    soundEngine.playSelect();
  }, []);

  const handleFitOverview = useCallback(() => {
    const { w, h } = stageSizeRef.current;
    const gw = cityRef.current?.gridWidth ?? 36;
    const gh = cityRef.current?.gridHeight ?? 36;
    const span = (gw + gh) / 2;
    const worldW = span * 32 + 110;
    const worldH = span * 16 + 170;
    const fitZoom = Math.max(
      MIN_ZOOM,
      Math.min(1.15, Math.min(w / worldW, h / worldH))
    );
    cameraRef.current = {
      ...cameraRef.current,
      panX: 0,
      panY: 0,
      zoom: fitZoom,
    };
    setZoomUi(fitZoom);
    soundEngine.playSelect();
  }, []);

  const showSaveToast = useCallback((msg: string) => {
    setSaveToast(msg);
    setJustSaved(true);
    if (saveFeedbackTimerRef.current !== null) {
      window.clearTimeout(saveFeedbackTimerRef.current);
    }
    saveFeedbackTimerRef.current = window.setTimeout(() => {
      setJustSaved(false);
      setSaveToast(null);
      saveFeedbackTimerRef.current = null;
    }, 2400);
  }, []);

  const handleStartGame = useCallback(() => {
    const cleanName = sanitizeCityName(newCityNameRef.current);
    if (cityRef.current) {
      setCityName(cityRef.current, cleanName);
      cityRef.current.news[0] = {
        ...cityRef.current.news[0],
        text: `${cleanName} fundada no modo ${
          cityRef.current.difficulty === 'easy'
            ? 'Fácil'
            : cityRef.current.difficulty === 'hard'
              ? 'Difícil'
              : 'Médio'
        }! Traço: ${cityRef.current.trait.name} — ${cityRef.current.trait.summary}`,
      };
      setHud(createHudSnapshot(cityRef.current));
    }
    document.body.dataset.state = 'playing';
    cameraRef.current = {
      panX: 0,
      panY: 0,
      zoom: DEFAULT_ZOOM,
      rotation: 0,
    };
    setZoomUi(DEFAULT_ZOOM);
    setRotationUi(0);
    setActiveModal(null);
    setSavesModalOpen(false);
    setReturnMenuOpen(false);
    setSpeed(1);
    lastNonZeroSpeedRef.current = 1;
    setScreenState('playing');
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    soundEngine.playNewCity();
  }, []);

  const handleChangeTitleCityName = useCallback((rawName: string) => {
    setNewCityName(rawName);
    newCityNameRef.current = rawName;
    if (cityRef.current) {
      setCityName(cityRef.current, rawName);
      setHud(createHudSnapshot(cityRef.current));
    }
  }, []);

  const handleSelectTitleDifficulty = useCallback((nextDiff: DifficultyLevel) => {
    const sanitized = sanitizeDifficulty(nextDiff);
    setSelectedDifficulty(sanitized);
    selectedDifficultyRef.current = sanitized;
    const currentSeed = cityRef.current?.seed;
    const nextCity = createNewCity(currentSeed, sanitized, newCityNameRef.current);
    cityRef.current = nextCity;
    carsRef.current = [];
    boatsRef.current = [];
    planesRef.current = [];
    helicoptersRef.current = [];
    particlesRef.current = createParticlePool();
    particleCursorRef.current.idx = 0;
    setHud(createHudSnapshot(nextCity));
    soundEngine.playSelect();
  }, []);

  const handleChangeLiveDifficulty = useCallback(
    (nextDiff: DifficultyLevel) => {
      if (!cityRef.current) return;
      const sanitized = sanitizeDifficulty(nextDiff);
      setSelectedDifficulty(sanitized);
      selectedDifficultyRef.current = sanitized;
      if (setCityDifficulty(cityRef.current, sanitized)) {
        soundEngine.playSelect();
        syncHud();
      }
    },
    [syncHud]
  );

  const handleNewCity = useCallback(() => {
    const nextCity = createNewCity(
      undefined,
      selectedDifficultyRef.current,
      newCityNameRef.current
    );
    cityRef.current = nextCity;
    carsRef.current = [];
    boatsRef.current = [];
    planesRef.current = [];
    helicoptersRef.current = [];
    particlesRef.current = createParticlePool();
    particleCursorRef.current.idx = 0;
    cameraRef.current = {
      panX: 0,
      panY: 0,
      zoom: DEFAULT_ZOOM,
      rotation: 0,
    };
    setZoomUi(DEFAULT_ZOOM);
    setRotationUi(0);
    setActiveModal(null);
    setEmergencyFeedback(null);
    setMapFilter('normal');
    setSpeed(1);
    lastNonZeroSpeedRef.current = 1;
    setHud(createHudSnapshot(nextCity));
    if (screenStateRef.current === 'paused') {
      document.body.dataset.state = 'playing';
      setScreenState('playing');
    }
    soundEngine.playNewCity();
  }, []);

  const handleSetSpeed = useCallback((nextSpeed: SimSpeed) => {
    if (nextSpeed !== 0) {
      lastNonZeroSpeedRef.current = nextSpeed;
    }
    setSpeed(nextSpeed);
    soundEngine.playSelect();
  }, []);

  const handleSetFilter = useCallback((nextFilter: MapFilter) => {
    setMapFilter(nextFilter);
    soundEngine.playSelect();
  }, []);

  const handleCycleLighting = useCallback(() => {
    setTimeOfDay((prev) =>
      prev === 'auto' ? 'day' : prev === 'day' ? 'dusk' : prev === 'dusk' ? 'night' : 'auto'
    );
    soundEngine.playSelect();
  }, []);

  const handleCycleSeason = useCallback(() => {
    if (!cityRef.current) return;
    cycleCitySeasonMode(cityRef.current);
    soundEngine.playSelect();
    syncHud();
  }, [syncHud]);

  const handleToggleMute = useCallback(() => {
    const isNowMuted = soundEngine.toggleMute();
    setMuted(isNowMuted);
  }, []);

  const handleToggleModalTab = useCallback((tab: ModalTab) => {
    setEmergencyFeedback(null);
    setSavesModalOpen(false);
    setReturnMenuOpen(false);
    if (screenStateRef.current === 'paused') {
      document.body.dataset.state = 'playing';
      setScreenState('playing');
    }
    setActiveModal((prev) => (prev === tab ? null : tab));
    soundEngine.playSelect();
  }, []);

  const handleOpenSaves = useCallback(() => {
    setActiveModal(null);
    setReturnMenuOpen(false);
    setSavesFeedback(null);
    setSavedGames(loadSavedCitiesFromStorage());
    setSavesModalOpen(true);
    soundEngine.playSelect();
  }, []);

  const handleQuickSave = useCallback(() => {
    if (!cityRef.current) return;
    const nextList = saveCurrentCityToStorage(cityRef.current, { isAutoSave: false });
    setSavedGames(nextList);
    soundEngine.playLevel3();
    showSaveToast(
      `Jogo salvo: ${sanitizeCityName(cityRef.current.cityName)} (${formatDateLabel(
        cityRef.current.month,
        cityRef.current.year
      )})`
    );
  }, [showSaveToast]);

  const handleSaveCurrentAs = useCallback(
    (customName: string) => {
      if (!cityRef.current) return;
      const nextList = saveCurrentCityToStorage(cityRef.current, {
        customName,
        isAutoSave: false,
      });
      setSavedGames(nextList);
      syncHud();
      setSavesFeedback(
        `Cidade "${sanitizeCityName(cityRef.current.cityName)}" salva com sucesso!`
      );
      soundEngine.playLevel3();
    },
    [syncHud]
  );

  const applyLoadedCity = useCallback((loaded: CityState, label: string) => {
    cityRef.current = loaded;
    carsRef.current = [];
    boatsRef.current = [];
    planesRef.current = [];
    helicoptersRef.current = [];
    particlesRef.current = createParticlePool();
    particleCursorRef.current.idx = 0;
    cameraRef.current = {
      panX: 0,
      panY: 0,
      zoom: DEFAULT_ZOOM,
      rotation: 0,
    };
    setZoomUi(DEFAULT_ZOOM);
    setRotationUi(0);
    const loadedDiff = sanitizeDifficulty(loaded.difficulty);
    setSelectedDifficulty(loadedDiff);
    selectedDifficultyRef.current = loadedDiff;
    setNewCityName(loaded.cityName);
    newCityNameRef.current = loaded.cityName;
    setHud(createHudSnapshot(loaded));
    setSavesFeedback(label);
    setSavesModalOpen(false);
    setReturnMenuOpen(false);
    setActiveModal(null);
    setSpeed(1);
    lastNonZeroSpeedRef.current = 1;
    document.body.dataset.state = 'playing';
    setScreenState('playing');
    soundEngine.playNewCity();
  }, []);

  const handleLoadSavedGame = useCallback(
    (saveId: string) => {
      const list = loadSavedCitiesFromStorage();
      const rec = list.find((r) => r.saveId === saveId);
      if (!rec) {
        setSavesFeedback('Save não encontrado na memória.');
        return;
      }
      const restored = deserializeCitySave(rec.stateJson);
      if (!restored) {
        setSavesFeedback('Não foi possível carregar os dados deste save.');
        return;
      }
      restored.cityName = sanitizeCityName(rec.name || restored.cityName);
      restored.saveId = rec.saveId;
      applyLoadedCity(
        restored,
        `Cidade "${restored.cityName}" (${formatDateLabel(restored.month, restored.year)}) carregada!`
      );
    },
    [applyLoadedCity]
  );

  const handleDeleteSavedGame = useCallback((saveId: string) => {
    const nextList = deleteSavedCityFromStorage(saveId);
    setSavedGames(nextList);
    setSavesFeedback('Save removido da memória.');
    soundEngine.playSelect();
  }, []);

  const resetPreviewCityForTitle = useCallback(() => {
    const freshName = 'Pixópolis';
    setNewCityName(freshName);
    newCityNameRef.current = freshName;
    const fresh = createNewCity(undefined, selectedDifficultyRef.current, freshName);
    cityRef.current = fresh;
    carsRef.current = [];
    boatsRef.current = [];
    planesRef.current = [];
    helicoptersRef.current = [];
    particlesRef.current = createParticlePool();
    particleCursorRef.current.idx = 0;
    setHud(createHudSnapshot(fresh));
  }, []);

  const handleRequestReturnMenu = useCallback(() => {
    setActiveModal(null);
    setSavesModalOpen(false);
    setReturnMenuOpen(true);
    soundEngine.playSelect();
  }, []);

  const handleSaveAndExit = useCallback(() => {
    if (cityRef.current) {
      const nextList = saveCurrentCityToStorage(cityRef.current, { isAutoSave: false });
      setSavedGames(nextList);
    }
    setReturnMenuOpen(false);
    setActiveModal(null);
    setSavesModalOpen(false);
    resetPreviewCityForTitle();
    document.body.dataset.state = 'title';
    setScreenState('title');
    soundEngine.playSelect();
  }, [resetPreviewCityForTitle]);

  const handleExitWithoutSaving = useCallback(() => {
    setSavedGames(loadSavedCitiesFromStorage());
    setReturnMenuOpen(false);
    setActiveModal(null);
    setSavesModalOpen(false);
    resetPreviewCityForTitle();
    document.body.dataset.state = 'title';
    setScreenState('title');
    soundEngine.playSelect();
  }, [resetPreviewCityForTitle]);

  const handleExportSaveCode = useCallback(() => {
    if (!cityRef.current) return '';
    return serializeCitySave(cityRef.current);
  }, []);

  const handleImportSaveCode = useCallback(
    (rawJson: string) => {
      const restored = deserializeCitySave(rawJson);
      if (!restored) {
        setSavesFeedback('Código JSON inválido ou corrompido.');
        return;
      }
      applyLoadedCity(restored, `Cidade #${restored.seed} importada com sucesso!`);
    },
    [applyLoadedCity]
  );

  const handleSetBudget = useCallback(
    (area: BudgetAreaKey, amount: number) => {
      if (!cityRef.current) return;
      if (setCityBudget(cityRef.current, area, amount)) {
        syncHud();
      }
    },
    [syncHud]
  );

  const handleSetBudgetTargetPct = useCallback(
    (area: BudgetAreaKey, targetPct: number) => {
      if (!cityRef.current) return;
      if (setCityBudgetTargetPct(cityRef.current, area, targetPct)) {
        soundEngine.playSelect();
        syncHud();
      }
    },
    [syncHud]
  );

  const handleSetTaxRate = useCallback(
    (sector: keyof TaxRates, rate: number) => {
      if (!cityRef.current) return;
      if (setTaxRate(cityRef.current, sector, rate)) {
        soundEngine.playSelect();
        syncHud();
      }
    },
    [syncHud]
  );

  const handleSetCondoPolicy = useCallback(
    (policy: CondoPolicy) => {
      if (!cityRef.current) return;
      if (setCondoPolicy(cityRef.current, policy)) {
        soundEngine.playSelect();
        syncHud();
      }
    },
    [syncHud]
  );

  const handleSetTollTariff = useCallback(
    (tariff: TollTariffLevel) => {
      if (!cityRef.current) return;
      if (setTollTariff(cityRef.current, tariff)) {
        soundEngine.playSelect();
        syncHud();
      }
    },
    [syncHud]
  );

  const handleExecuteEmergency = useCallback(
    (actionId: EmergencyActionId) => {
      if (!cityRef.current) return;
      const res = executeEmergencyAction(cityRef.current, actionId);
      if (res.ok) {
        flushSounds(cityRef.current);
        if (actionId === 'incident_response') {
          setEmergencyFeedback(`${res.executedTitle ?? 'Intervenção'} concluída! Cidade estabilizada.`);
        } else if (actionId === 'toll_plaza_project') {
          setEmergencyFeedback(
            `${res.executedTitle ?? 'Praça de Pedágio'} inaugurada na rodovia externa! Ajuste a tarifa em Finanças ou clicando no pedágio.`
          );
        } else {
          setEmergencyFeedback(
            `${res.executedTitle ?? 'Obra'} executada! Linha evoluída para Fase ${res.evolvedToTier ?? 2}.`
          );
        }
        syncHud();
      } else if (res.reason) {
        setEmergencyFeedback(res.reason);
      }
    },
    [flushSounds, syncHud]
  );

  const handleExpandLand = useCallback(
    (direction: ExpandDirection) => {
      if (!cityRef.current) return;
      const res = expandCityLand(
        cityRef.current,
        direction,
        carsRef.current,
        boatsRef.current,
        particlesRef.current
      );
      if (res.ok) {
        flushSounds(cityRef.current);
        setEmergencyFeedback(
          `Território expandido! Novo mapa: ${cityRef.current.gridWidth}×${cityRef.current.gridHeight} lotes.`
        );
        syncHud();
      } else if (res.reason) {
        setEmergencyFeedback(res.reason);
      }
    },
    [flushSounds, syncHud]
  );

  const handleNavigateNeed = useCallback((tab: ModalTab) => {
    setEmergencyFeedback(null);
    setSavesModalOpen(false);
    setReturnMenuOpen(false);
    if (screenStateRef.current === 'paused') {
      document.body.dataset.state = 'playing';
      setScreenState('playing');
    }
    setActiveModal(tab);
    soundEngine.playSelect();
  }, []);

  const handleDismissMilestone = useCallback(() => {
    if (!cityRef.current) return;
    dismissMilestoneBanner(cityRef.current);
    syncHud();
  }, [syncHud]);

  const handleDemolishAt = useCallback(
    (tx: number, ty: number) => {
      if (!cityRef.current) return;
      const res = demolishCityTile(cityRef.current, tx, ty);
      if (res.ok) {
        flushSounds(cityRef.current);
        setDemolishFeedback(
          `${res.demolishedLabel ?? 'Lote'} demolido (${res.tilesCleared} ${res.tilesCleared === 1 ? 'quadrado liberado' : 'quadrados liberados'} para reconstrução)!`
        );
        setSelectedTileCoords(null);
        syncHud();
      } else if (res.reason) {
        setDemolishFeedback(res.reason);
      }
    },
    [flushSounds, syncHud]
  );

  const handleConvertCondoAt = useCallback(
    (tx: number, ty: number) => {
      if (!cityRef.current) return;
      const res = convertBuildingToCondo(cityRef.current, tx, ty);
      if (res.ok) {
        flushSounds(cityRef.current);
        setDemolishFeedback(
          `Convertido em ${res.newLabel ?? 'Condomínio'} (+${(res.popGain ?? 0).toLocaleString('pt-BR')} hab.)!`
        );
        syncHud();
      } else if (res.reason) {
        setDemolishFeedback(res.reason);
      }
    },
    [flushSounds, syncHud]
  );

  // Measure full-viewport 100vw x 100vh 3D map container via ResizeObserver
  useEffect(() => {
    const el = stageContainerRef.current;
    if (!el) return;

    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      const w = Math.max(320, Math.floor(rect.width));
      const h = Math.max(300, Math.floor(rect.height));
      stageSizeRef.current = { w, h };
    };

    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Native non-passive wheel listener on canvas for cursor-centered zoom
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onWheel = (e: WheelEvent) => {
      if (screenStateRef.current !== 'playing' || activeModalRef.current !== null) {
        return;
      }
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      applyCameraZoom(cameraRef.current.zoom * factor, sx, sy);
    };

    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [applyCameraZoom]);

  // Keyboard shortcuts & smooth WASD / Arrow camera pan
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      if (screenStateRef.current === 'title') {
        return;
      }

      if (returnMenuOpenRef.current && e.code === 'Escape') {
        e.preventDefault();
        setReturnMenuOpen(false);
        return;
      }

      // Let open management modals handle ESC first
      if ((activeModalRef.current !== null || savesModalOpenRef.current) && e.code === 'Escape') {
        return;
      }

      if (e.code === 'Escape' || e.key === 'p' || e.key === 'P') {
        e.preventDefault();
        keysHeldRef.current.clear();
        setScreenState((prev) => {
          const next = prev === 'paused' ? 'playing' : 'paused';
          document.body.dataset.state = next;
          return next;
        });
        return;
      }

      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        if (e.key === 'b' || e.key === 'B' || e.code === 'F1') {
          e.preventDefault();
          keysHeldRef.current.clear();
          handleToggleModalTab('budget');
          return;
        }
        if (e.key === 'f' || e.key === 'F' || e.code === 'F2') {
          e.preventDefault();
          keysHeldRef.current.clear();
          handleToggleModalTab('finances');
          return;
        }
        if (e.key === 'o' || e.key === 'O' || e.code === 'F3') {
          e.preventDefault();
          keysHeldRef.current.clear();
          handleToggleModalTab('emergencies');
          return;
        }
        if (e.key === 'r' || e.key === 'R' || e.code === 'F4') {
          e.preventDefault();
          keysHeldRef.current.clear();
          handleToggleModalTab('report');
          return;
        }
      }

      if (screenStateRef.current !== 'playing') return;

      // Only pan map with WASD when no modal is covering the map
      if (activeModalRef.current === null) {
        keysHeldRef.current.add(e.code);
      }

      if (e.code === 'Space') {
        e.preventDefault();
        setSpeed((prev) =>
          prev === 0 ? lastNonZeroSpeedRef.current : 0
        );
      } else if (e.key === '1') {
        handleSetSpeed(1);
      } else if (e.key === '2') {
        handleSetSpeed(2);
      } else if (e.key === '3' || e.key === '4') {
        handleSetSpeed(4);
      } else if (e.key === 'm' || e.key === 'M') {
        handleToggleMute();
      } else if (
        activeModalRef.current === null &&
        (e.key === '+' || e.key === '=' || e.code === 'NumpadAdd')
      ) {
        e.preventDefault();
        handleZoomStep(1.2);
      } else if (
        activeModalRef.current === null &&
        (e.key === '-' || e.key === '_' || e.code === 'NumpadSubtract')
      ) {
        e.preventDefault();
        handleZoomStep(1 / 1.2);
      } else if (activeModalRef.current === null && (e.key === 'q' || e.key === 'Q')) {
        handleRotateCamera(-1);
      } else if (activeModalRef.current === null && (e.key === 'e' || e.key === 'E')) {
        handleRotateCamera(1);
      } else if (activeModalRef.current === null && e.key === '0') {
        handleResetCamera();
      } else if (activeModalRef.current === null && (e.key === 'x' || e.key === 'X')) {
        setDemolishMode((prev) => !prev);
        setSelectedTileCoords(null);
        soundEngine.playSelect();
      } else if (activeModalRef.current === null && (e.key === 'l' || e.key === 'L')) {
        handleCycleLighting();
      } else if (activeModalRef.current === null && (e.key === 'k' || e.key === 'K')) {
        handleCycleSeason();
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      keysHeldRef.current.delete(e.code);
    };

    const clearKeys = () => {
      keysHeldRef.current.clear();
      activePointersRef.current.clear();
      pinchRef.current.active = false;
      dragRef.current.active = false;
      setIsDragging(false);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', clearKeys);
    document.addEventListener('visibilitychange', clearKeys);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', clearKeys);
      document.removeEventListener('visibilitychange', clearKeys);
    };
  }, [
    handleCycleLighting,
    handleCycleSeason,
    handleResetCamera,
    handleRotateCamera,
    handleSetSpeed,
    handleStartGame,
    handleToggleModalTab,
    handleToggleMute,
    handleZoomStep,
  ]);

  // Decoupled Fullscreen 3D Canvas Render & Realistic Calendar Simulation Loop
  useEffect(() => {
    let rafId = 0;
    let lastTime = performance.now();
    let renderAccum = 1;
    let progressHudAccum = 0;
    let titleElapsedSec = 0;
    let worldTimeSec = 0;
    let lastViewKey = '';

    const frame = (now: number) => {
      const rawDt = (now - lastTime) / 1000;
      lastTime = now;
      const dt = Math.min(Math.max(rawDt, 0), 0.05);
      renderAccum += dt;

      const state = cityRef.current!;
      const mode = screenStateRef.current;
      const curSpeed = speedRef.current;
      const isPaused = mode === 'paused' || (mode === 'playing' && curSpeed === 0);
      const simRunning = mode === 'playing' && curSpeed > 0;

      if (mode === 'title') {
        titleElapsedSec += dt;
      }
      if (!isPaused) {
        worldTimeSec += dt;
        worldTimeSecRef.current = worldTimeSec;
      }

      // Smooth keyboard camera panning (WASD / Arrows)
      if (mode === 'playing' && activeModalRef.current === null && keysHeldRef.current.size > 0) {
        const panSpeed = (280 / cameraRef.current.zoom) * dt;
        let dx = 0;
        let dy = 0;
        if (keysHeldRef.current.has('KeyA') || keysHeldRef.current.has('ArrowLeft')) dx -= 1;
        if (keysHeldRef.current.has('KeyD') || keysHeldRef.current.has('ArrowRight')) dx += 1;
        if (keysHeldRef.current.has('KeyW') || keysHeldRef.current.has('ArrowUp')) dy -= 1;
        if (keysHeldRef.current.has('KeyS') || keysHeldRef.current.has('ArrowDown')) dy += 1;
        if (dx !== 0 || dy !== 0) {
          cameraRef.current = clampCamera(
            {
              ...cameraRef.current,
              panX: cameraRef.current.panX + dx * panSpeed,
              panY: cameraRef.current.panY + dy * panSpeed,
            },
            state.gridWidth,
            state.gridHeight
          );
        }
      } else if (mode === 'title') {
        cameraRef.current = {
          panX: Math.sin(titleElapsedSec * 0.18) * 65,
          panY: Math.cos(titleElapsedSec * 0.14) * 30,
          zoom: 1.45,
          rotation: 0,
        };
      }

      let hudDirty = false;

      if (simRunning) {
        const { grew, monthClosed, yearChanged } = advanceSimulationTime(
          state,
          dt * curSpeed
        );
        if (yearChanged) {
          setSavedGames(loadSavedCitiesFromStorage());
          showSaveToast(
            `Auto-save anual: ${sanitizeCityName(state.cityName)} (${formatDateLabel(
              state.month,
              state.year
            )})`
          );
        }
        if (grew || monthClosed) {
          hudDirty = true;
        } else {
          progressHudAccum += dt;
          if (progressHudAccum >= 0.25) {
            progressHudAccum = 0;
            hudDirty = true;
          }
        }
      }

      const ambientScale = isPaused ? 0 : mode === 'title' ? 0.55 : curSpeed * 0.7;

      if (!isPaused) {
        updateCarsAndParticles(
          state,
          carsRef.current,
          particlesRef.current,
          particleCursorRef.current,
          dt,
          ambientScale,
          worldTimeSec
        );
        updateBoatsAndPlanes(
          state,
          boatsRef.current,
          planesRef.current,
          particlesRef.current,
          particleCursorRef.current,
          dt,
          ambientScale,
          helicoptersRef.current
        );
      }

      if (hudDirty) {
        flushSounds(state);
        setHud(createHudSnapshot(state));
      }

      const cam = cameraRef.current;
      const viewKey = `${cam.panX.toFixed(2)},${cam.panY.toFixed(2)},${cam.zoom.toFixed(4)},${cam.rotation},${mapFilterRef.current},${timeOfDayRef.current},${mode},${curSpeed}`;
      const viewChanged = viewKey !== lastViewKey;
      if (viewChanged) {
        lastViewKey = viewKey;
      }

      const isMovingCamera =
        dragRef.current.active ||
        pinchRef.current.active ||
        (mode === 'playing' && activeModalRef.current === null && keysHeldRef.current.size > 0);
      const minInterval = isMovingCamera
        ? 0.033
        : isPaused
          ? 0.5
          : mode === 'title'
            ? 0.35
            : activeModalRef.current !== null
              ? 0.25
              : 0.08;

      if (renderAccum >= minInterval || hudDirty || viewChanged) {
        const renderStart = performance.now();
        const canvas = canvasRef.current;
        if (canvas) {
          // Keep full 1:1 native pixel resolution at all zoom levels (no blurry downscaling!)
          const renderScale = 1.0;
          const logicalW = stageSizeRef.current.w;
          const logicalH = stageSizeRef.current.h;
          const targetW = Math.max(240, Math.round(logicalW * renderScale));
          const targetH = Math.max(200, Math.round(logicalH * renderScale));
          if (canvas.width !== targetW || canvas.height !== targetH) {
            canvas.width = targetW;
            canvas.height = targetH;
          }

          const ctx = canvas.getContext('2d');
          if (ctx) {
            renderCityCanvas(ctx, state, carsRef.current, particlesRef.current, {
              camera: cameraRef.current,
              hoveredTile: hoveredTileRef.current,
              mapFilter: mapFilterRef.current,
              timeSeconds: worldTimeSec,
              timeOfDay: timeOfDayRef.current,
              boats: boatsRef.current,
              planes: planesRef.current,
              helicopters: helicoptersRef.current,
              renderScale,
              logicalWidth: logicalW,
              logicalHeight: logicalH,
            });
          }
        }
        const overlayEl = lightingOverlayRef.current;
        if (overlayEl) {
          const overlay = getAtmosphericGradientOverlay(
            timeOfDayRef.current,
            worldTimeSec,
            state.weather.season,
            state.weather.kind,
            state.weather.intensity
          );
          overlayEl.style.backgroundImage = overlay.gradientCss;
          overlayEl.style.opacity = overlay.opacity.toFixed(3);
          overlayEl.dataset.phase = overlay.phase;
          overlayEl.dataset.darkness = overlay.darknessLevel.toFixed(2);
        }
        const renderMs = performance.now() - renderStart;
        renderAccum = renderMs > 30 ? -Math.min(0.08, (renderMs - 20) * 0.0012) : 0;
      }

      rafId = requestAnimationFrame(frame);
    };

    rafId = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafId);
  }, [flushSounds, showSaveToast]);

  // Pointer helpers (exact isometric diamond hit-testing in logical CSS coordinates + drag-to-pan)
  const getIsoCoordsFromClient = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    const gw = cityRef.current?.gridWidth ?? 36;
    const gh = cityRef.current?.gridHeight ?? 36;
    return screenToGrid(
      sx,
      sy,
      rect.width,
      rect.height,
      cameraRef.current,
      gw,
      gh
    );
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (screenState !== 'playing' || activeModal !== null || savesModalOpen) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore capture errors on synthetic or rapidly changing touch pointers
    }
    activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activePointersRef.current.size === 1) {
      pinchRef.current.active = false;
      dragRef.current = {
        active: true,
        moved: false,
        startX: e.clientX,
        startY: e.clientY,
        startPanX: cameraRef.current.panX,
        startPanY: cameraRef.current.panY,
      };
    } else if (activePointersRef.current.size === 2) {
      // Enter two-finger pinch-to-zoom + midpoint pan (strictly no rotation!)
      const pts = Array.from(activePointersRef.current.values());
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      const midX = (pts[0].x + pts[1].x) / 2;
      const midY = (pts[0].y + pts[1].y) / 2;
      dragRef.current.active = false;
      pinchRef.current = {
        active: true,
        startDist: Math.max(12, dist),
        startZoom: cameraRef.current.zoom,
        prevMidX: midX,
        prevMidY: midY,
      };
      setIsDragging(true);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (screenState !== 'playing' || !cityRef.current) return;

    if (activePointersRef.current.has(e.pointerId)) {
      activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    // Two-finger pinch-to-zoom + drag pan (never rotates camera!)
    if (activePointersRef.current.size >= 2 && pinchRef.current.active) {
      const pts = Array.from(activePointersRef.current.values());
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      const midX = (pts[0].x + pts[1].x) / 2;
      const midY = (pts[0].y + pts[1].y) / 2;
      const dxMid = midX - pinchRef.current.prevMidX;
      const dyMid = midY - pinchRef.current.prevMidY;
      pinchRef.current.prevMidX = midX;
      pinchRef.current.prevMidY = midY;

      const cur = cameraRef.current;
      const panned = clampCamera(
        {
          ...cur,
          panX: cur.panX - dxMid / cur.zoom,
          panY: cur.panY - dyMid / cur.zoom,
        },
        cityRef.current.gridWidth,
        cityRef.current.gridHeight
      );
      cameraRef.current = panned;

      const scale = dist / Math.max(12, pinchRef.current.startDist);
      const targetZoom = pinchRef.current.startZoom * scale;
      const canvas = canvasRef.current;
      if (canvas) {
        const rect = canvas.getBoundingClientRect();
        applyCameraZoom(targetZoom, midX - rect.left, midY - rect.top);
      } else {
        applyCameraZoom(targetZoom);
      }
      return;
    }

    // One-finger touch drag or mouse drag pan (all 4 directions: left, right, up, down)
    if (dragRef.current.active) {
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      if (!dragRef.current.moved && Math.hypot(dx, dy) >= 4) {
        dragRef.current.moved = true;
        setIsDragging(true);
      }
      if (dragRef.current.moved) {
        const z = cameraRef.current.zoom;
        cameraRef.current = clampCamera(
          {
            ...cameraRef.current,
            panX: dragRef.current.startPanX - dx / z,
            panY: dragRef.current.startPanY - dy / z,
          },
          cityRef.current.gridWidth,
          cityRef.current.gridHeight
        );
        return;
      }
    }

    if (activeModal !== null || e.pointerType === 'touch') return;

    const coords = getIsoCoordsFromClient(e.clientX, e.clientY);
    if (!coords) {
      hoveredTileRef.current = null;
      setHoveredInfo(null);
      return;
    }

    const tile = getTile(cityRef.current, coords.tx, coords.ty);
    if (!tile) return;
    hoveredTileRef.current = coords;

    if (isTollPlazaTile(cityRef.current, coords.tx, coords.ty) && cityRef.current.tollPlaza.built) {
      const cfg = TOLL_TARIFF_CONFIGS[cityRef.current.tollPlaza.tariff];
      setHoveredInfo(
        `Praça de Pedágio · Tarifa ${cfg.label} · Visitantes ${cityRef.current.stats.visitorTrafficPct}% · +$${cityRef.current.financials.revenue.tollIncome.toLocaleString('pt-BR')}/mês`
      );
      return;
    }

    if (isExternalBorderRoadTile(cityRef.current, coords.tx, coords.ty)) {
      setHoveredInfo(
        `Rodovia Externa (Entrada / Saída) · Fluxo de Visitantes ${cityRef.current.stats.visitorTrafficPct}%`
      );
      return;
    }

    const typeLabel =
      tile.type === 'road'
        ? getRoadClassLabel(tile.level || 1, tile.variant || 0)
        : tile.type === 'bridge'
          ? (tile.level || 1) >= 4
            ? isDoubleWidthBridgeTile(cityRef.current, tile.x, tile.y)
              ? 'Megaponte Expressa (2 Espaços)'
              : 'Megaponte Estaiada Expressa'
            : (tile.level || 1) === 3
              ? 'Ponte Estaiada de Duas Faixas'
              : (tile.level || 1) === 2
                ? 'Ponte de Arcos Metálicos Dupla'
                : (tile.variant || 0) === 1
                  ? 'Ponte de Pedra Dupla'
                  : 'Ponte de Pedra'
          : tile.type === 'rural' ||
              tile.type === 'residential' ||
              tile.type === 'commercial' ||
              tile.type === 'industrial' ||
              tile.type === 'airport' ||
              tile.type === 'stadium' ||
              tile.type === 'port' ||
              tile.type === 'bus_station' ||
              tile.type === 'metro_station' ||
              tile.type === 'shopping' ||
              tile.type === 'park' ||
              tile.type === 'abandoned'
            ? getZoneDisplayLabel(tile)
            : TILE_LABELS[tile.type];
    const lvText =
      tile.type === 'rural' ||
      tile.type === 'residential' ||
      tile.type === 'commercial' ||
      tile.type === 'industrial' ||
      tile.type === 'bridge' ||
      tile.type === 'port' ||
      tile.type === 'airport' ||
      tile.type === 'bus_station' ||
      tile.type === 'metro_station' ||
      tile.type === 'shopping'
        ? ` Nv.${tile.level || 1}`
        : '';
    const districtSuffix =
      tile.type === 'residential' ||
      tile.type === 'commercial' ||
      tile.type === 'industrial'
        ? ` · ${getNeighborhoodDistrictLabel(getNeighborhoodDistrict(cityRef.current, tile.x, tile.y))}`
        : '';
    setHoveredInfo(
      `${typeLabel}${lvText}${districtSuffix} · Pol ${tile.pollution}% · Val ${tile.landValue}`
    );
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    activePointersRef.current.delete(e.pointerId);

    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Ignore release errors when pointer is already released
    }

    // If lifting 1 finger from a 2-finger pinch, seamlessly hand off to 1-finger pan without jumping
    if (activePointersRef.current.size === 1) {
      const remaining = Array.from(activePointersRef.current.values())[0];
      pinchRef.current.active = false;
      dragRef.current = {
        active: true,
        moved: true,
        startX: remaining.x,
        startY: remaining.y,
        startPanX: cameraRef.current.panX,
        startPanY: cameraRef.current.panY,
      };
      return;
    }

    if (activePointersRef.current.size === 0) {
      const wasTap = dragRef.current.active && !dragRef.current.moved && !pinchRef.current.active;
      pinchRef.current.active = false;
      dragRef.current.active = false;
      dragRef.current.moved = false;
      setIsDragging(false);

      if (wasTap && cityRef.current && screenState === 'playing' && activeModal === null) {
        const coords = getIsoCoordsFromClient(e.clientX, e.clientY);
        if (coords) {
          const clickedTile = getTile(cityRef.current, coords.tx, coords.ty);
          if (clickedTile) {
            if (demolishMode) {
              handleDemolishAt(coords.tx, coords.ty);
            } else if (
              clickedTile.type !== 'water' &&
              clickedTile.type !== 'grass' &&
              clickedTile.type !== 'forest'
            ) {
              setSelectedTileCoords(coords);
              setDemolishFeedback(null);
              soundEngine.playSelect();
            } else {
              setSelectedTileCoords(null);
            }
          }
        }
      }
    }
  };

  const handlePointerLeave = () => {
    if (!dragRef.current.active && !pinchRef.current.active) {
      hoveredTileRef.current = null;
      setHoveredInfo(null);
    }
  };

  const zoomPercent = Math.round(zoomUi * 100);
  const criticalNeedsCount = hud.needs.filter((n) => n.severity === 'critical').length;

  const financesBadge: NavBadgeSpec | null =
    hud.financials.netBalance < 0
      ? {
          text: '!',
          ariaLabel: 'Déficit mensal projetado',
          tone: 'critical',
        }
      : hud.activeEconomicEvent
        ? {
            text: '1',
            ariaLabel: hud.activeEconomicEvent.title,
            tone:
              hud.activeEconomicEvent.id === 'economic_boom'
                ? 'ready'
                : 'warning',
          }
        : null;

  const pendingWorksCount = hud.pendingWorks?.length ?? 0;
  const readyMilestoneWorksCount = hud.emergencyOffers.filter(
    (o) =>
      o.id !== 'incident_response' &&
      o.unlocked &&
      !o.inProgress &&
      o.tier === 1 &&
      hud.money >= o.cost
  ).length;

  const worksBadge: NavBadgeSpec | null = hud.activeUrbanIncident
    ? {
        text: '!',
        ariaLabel: 'Imprevisto urbano ativo',
        tone: 'critical',
      }
    : pendingWorksCount > 0
      ? {
          text: String(pendingWorksCount),
          ariaLabel: `${pendingWorksCount} ${pendingWorksCount === 1 ? 'obra em andamento' : 'obras em andamento'}`,
          tone: 'active',
        }
      : hud.recentMilestoneBanner || readyMilestoneWorksCount > 0
        ? {
            text:
              readyMilestoneWorksCount > 0
                ? String(readyMilestoneWorksCount)
                : '★',
            ariaLabel: 'Nova obra ou marco disponível para construção',
            tone: 'ready',
          }
        : null;

  const initialOverlay = getAtmosphericGradientOverlay(
    timeOfDay,
    worldTimeSecRef.current,
    hud.weather.season,
    hud.weather.kind,
    hud.weather.intensity
  );

  return (
    <div
      className="relative w-screen h-screen bg-[#0b101b] text-[#eef2f7] overflow-hidden"
      data-speed={speed}
      data-filter={mapFilter}
      data-lighting={timeOfDay}
      data-difficulty={hud.difficulty}
      data-zoom={zoomPercent}
      data-rotation={rotationUi}
      data-modal={activeModal ?? 'none'}
    >
      {/* Fullscreen 100vw x 100vh Interactive 3D Isometric Canvas Stage */}
      <section
        ref={stageContainerRef}
        aria-label="Mapa 3D isométrico interativo de Pixópolis em tela cheia"
        className="fixed inset-0 w-screen h-screen bg-[#0b101b] overflow-hidden select-none touch-none"
      >
        <canvas
          ref={canvasRef}
          data-testid="city-canvas"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onPointerLeave={handlePointerLeave}
          className={`block w-full h-full touch-none ${
            isDragging ? 'cursor-grabbing' : 'cursor-grab'
          }`}
          aria-label="Mapa 3D isométrico 64-bit interativo. Arraste com o dedo ou mouse para mover em qualquer direção e use pinça ou roda do mouse para zoom."
        />
        {/* Animated Atmospheric Gradient Overlay (Day -> Dusk/Crepúsculo -> Night) */}
        <div
          ref={lightingOverlayRef}
          data-testid="time-of-day-gradient-overlay"
          data-phase={initialOverlay.phase}
          data-darkness={initialOverlay.darknessLevel.toFixed(2)}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-10 transition-opacity duration-700 ease-in-out"
          style={{
            backgroundImage: initialOverlay.gradientCss,
            opacity: initialOverlay.opacity,
          }}
        />
      </section>

      {/* Floating Semi-Transparent Top HUD */}
      {screenState !== 'title' ? (
        <TopHud
          hud={hud}
          speed={speed}
          mapFilter={mapFilter}
          muted={muted}
          justSaved={justSaved}
          onSetSpeed={handleSetSpeed}
          onSetFilter={handleSetFilter}
          onToggleMute={handleToggleMute}
          onQuickSave={handleQuickSave}
          onRequestReturnMenu={handleRequestReturnMenu}
          onCycleSeason={handleCycleSeason}
          onOpenPauseMenu={() => {
            setActiveModal(null);
            setSavesModalOpen(false);
            setReturnMenuOpen(false);
            document.body.dataset.state = 'paused';
            setScreenState('paused');
          }}
        />
      ) : null}

      {/* Discreet Save / Annual Auto-Save Confirmation Toast */}
      {saveToast && screenState !== 'title' ? (
        <div
          role="status"
          data-testid="save-toast"
          className="pointer-events-none fixed top-[84px] sm:top-[58px] right-3 z-30 px-3 py-1.5 bg-[#123326]/95 border-2 border-[#66d98c] text-[#e6ffef] font-pixel text-[8px] shadow-[0_6px_18px_rgba(0,0,0,0.45)]"
        >
          {saveToast}
        </div>
      ) : null}

      {/* Mobile Compact Map Filter Bar (paired on bottom-left beside Camera Dock on < sm screens) */}
      {screenState === 'playing' && activeModal === null ? (
        <div
          role="group"
          aria-label="Filtros do mapa mobile"
          className="flex sm:hidden fixed bottom-[104px] left-2 z-20 pixel-panel-glass p-1 gap-0.5 items-center"
        >
          {(
            [
              { f: 'normal' as MapFilter, label: 'Norm' },
              { f: 'pollution' as MapFilter, label: 'Pol' },
              { f: 'value' as MapFilter, label: 'Val' },
            ] as const
          ).map(({ f, label }) => (
            <button
              key={f}
              type="button"
              aria-pressed={mapFilter === f}
              onClick={() => handleSetFilter(f)}
              className={`pixel-btn px-1.5 h-7 font-pixel text-[7px] ${
                mapFilter === f
                  ? 'bg-[#56c2ff] text-[#111622]'
                  : 'bg-[#25314a] text-[#cfd9e8]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}

      {/* Active Map Filter Legend Badge */}
      {mapFilter !== 'normal' && screenState === 'playing' && activeModal === null ? (
        <div
          data-testid="filter-legend"
          className="pointer-events-none fixed top-[82px] sm:top-[56px] left-2 md:left-[116px] z-20 px-2.5 py-1 bg-[#111622]/90 border-2 border-[#334361] font-pixel text-[7px] sm:text-[8px] text-[#eef2f7]"
        >
          {mapFilter === 'pollution'
            ? 'FILTRO: POLUIÇÃO (VERMELHO = ALTA)'
            : 'FILTRO: VALOR IMOBILIÁRIO (OURO = ALTO)'}
        </div>
      ) : null}

      {/* Floating Active Random Events Strip (Economic Cycles & Urban Incidents) */}
      {(hud.activeEconomicEvent || hud.activeUrbanIncident) &&
      screenState === 'playing' &&
      activeModal === null ? (
        <div
          data-testid="active-events-strip"
          className={`fixed left-2 md:left-[116px] z-20 flex flex-wrap items-center gap-1.5 max-w-[calc(100vw-16px)] md:max-w-[calc(100vw-140px)] ${
            mapFilter !== 'normal'
              ? 'top-[116px] sm:top-[90px]'
              : 'top-[82px] sm:top-[56px]'
          }`}
        >
          {hud.activeUrbanIncident ? (
            <button
              type="button"
              data-testid="active-incident-badge"
              onClick={() => handleNavigateNeed('emergencies')}
              className="pixel-btn px-2.5 py-1 bg-[#4b1a20]/95 hover:bg-[#66222a] border-2 border-[#ff6b6b] text-[#ffe2e2] flex items-center gap-1.5 shadow-[0_6px_16px_rgba(0,0,0,0.45)]"
            >
              <AlertTriangle className="w-3.5 h-3.5 text-[#ff8787] shrink-0" aria-hidden="true" />
              <span className="font-pixel text-[7px] uppercase whitespace-nowrap">
                {hud.activeUrbanIncident.title} ({hud.activeUrbanIncident.remainingMonths}m)
              </span>
              <span className="hidden sm:inline text-[13px] text-[#ffc9c9]">
                · Resolver em Obras
              </span>
            </button>
          ) : null}

          {hud.activeEconomicEvent ? (
            <button
              type="button"
              data-testid="active-economic-badge"
              onClick={() => handleNavigateNeed('finances')}
              className={`pixel-btn px-2.5 py-1 border-2 flex items-center gap-1.5 shadow-[0_6px_16px_rgba(0,0,0,0.45)] ${
                hud.activeEconomicEvent.id === 'economic_boom'
                  ? 'bg-[#143525]/95 hover:bg-[#1a4731] border-[#66d98c] text-[#e6ffef]'
                  : 'bg-[#3d2911]/95 hover:bg-[#523717] border-[#f5b73b] text-[#fff3cd]'
              }`}
            >
              {hud.activeEconomicEvent.id === 'economic_boom' ? (
                <TrendingUp className="w-3.5 h-3.5 text-[#66d98c] shrink-0" aria-hidden="true" />
              ) : (
                <TrendingDown className="w-3.5 h-3.5 text-[#f5b73b] shrink-0" aria-hidden="true" />
              )}
              <span className="font-pixel text-[7px] uppercase whitespace-nowrap">
                {hud.activeEconomicEvent.title} ({hud.activeEconomicEvent.remainingMonths}m)
              </span>
            </button>
          ) : null}
        </div>
      ) : null}

      {/* Paused Clock Indicator */}
      {speed === 0 && screenState === 'playing' && activeModal === null ? (
        <div className="pointer-events-none fixed top-[82px] sm:top-[56px] right-3 z-20 px-2.5 py-1 bg-[#e05252] border-2 border-[#0b0f19] font-pixel text-[8px] text-white">
          PAUSADO
        </div>
      ) : null}

      {/* Celebratory Civic Milestone Unlock Banner */}
      {hud.recentMilestoneBanner && screenState === 'playing' && activeModal === null ? (
        <div
          role="status"
          data-testid="civic-milestone-banner"
          className="fixed top-[84px] sm:top-[58px] left-1/2 -translate-x-1/2 z-30 w-[min(92vw,540px)] pixel-panel-glass border-2 border-[#ffe066] px-3.5 py-2.5 shadow-[0_12px_32px_rgba(0,0,0,0.65)]"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2.5 min-w-0">
              <div className="w-8 h-8 shrink-0 bg-[#3a2d10] border border-[#ffe066] flex items-center justify-center text-[#ffe066]">
                <Award className="w-5 h-5" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-pixel text-[7.5px] text-[#ffe066]">
                    MARCO CÍVICO · {hud.recentMilestoneBanner.populationTarget.toLocaleString('pt-BR')} HAB
                  </span>
                  <span className="font-pixel text-[7px] px-1.5 py-0.5 bg-[#153624] border border-[#66d98c] text-[#66d98c]">
                    +${hud.recentMilestoneBanner.rewardCash.toLocaleString('pt-BR')}
                  </span>
                </div>
                <div className="font-pixel text-[10px] text-[#eef2f7] mt-0.5 leading-snug">
                  {hud.recentMilestoneBanner.title}
                </div>
                <p className="text-[15px] text-[#cfd9e8] leading-tight mt-0.5">
                  {hud.recentMilestoneBanner.subtitle}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {hud.recentMilestoneBanner.actionId ? (
                <button
                  type="button"
                  onClick={() => handleNavigateNeed('emergencies')}
                  className="pixel-btn px-2 py-1 bg-[#1e5c42] hover:bg-[#277856] text-[#eef2f7] font-pixel text-[7px] whitespace-nowrap"
                >
                  Construir em Obras
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => handleNavigateNeed('report')}
                  className="pixel-btn px-2 py-1 bg-[#2b6cb0] hover:bg-[#3582d4] text-white font-pixel text-[7px] whitespace-nowrap"
                >
                  Marcos
                </button>
              )}
              <button
                type="button"
                aria-label="Fechar aviso de marco cívico"
                onClick={handleDismissMilestone}
                className="pixel-btn w-6 h-6 flex items-center justify-center bg-[#25314a] hover:bg-[#314161] text-[#cfd9e8]"
              >
                <X className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Hovered Tile Info Tooltip (above bottom ticker on desktop) */}
      {hoveredInfo && screenState === 'playing' && activeModal === null ? (
        <div className="pointer-events-none hidden md:block fixed bottom-[50px] left-[116px] z-20 px-2.5 py-1 bg-[#111622]/90 border border-[#334361] text-[16px] text-[#dce6f2] tabular-nums">
          {hoveredInfo}
        </div>
      ) : null}

      {/* Active Demolish Mode / Selected Tile Quick-Demolish Card */}
      {screenState === 'playing' && activeModal === null && (demolishMode || selectedTileCoords || demolishFeedback) ? (
        <div
          data-testid="demolish-inspector"
          className="fixed bottom-[148px] md:bottom-[86px] left-2 md:left-[116px] z-20 max-w-[360px] pixel-panel-glass border-2 border-[#f5b73b] px-3 py-2 flex flex-col gap-1.5"
        >
          {demolishMode ? (
            <div className="flex items-center justify-between gap-2">
              <span className="font-pixel text-[7.5px] text-[#ff6b6b]">
                MODO DEMOLIÇÃO ATIVO (TECLA X)
              </span>
              <button
                type="button"
                onClick={() => {
                  setDemolishMode(false);
                  setDemolishFeedback(null);
                }}
                className="pixel-btn px-1.5 py-0.5 bg-[#25314a] text-[#cfd9e8] font-pixel text-[6.5px]"
              >
                Sair
              </button>
            </div>
          ) : null}

          {demolishMode ? (
            <p className="text-[14px] text-[#dce6f2] leading-tight">
              Clique em qualquer casa, prédio, rua ou ponte no mapa para demolir e liberar o terreno para reconstruir e evoluir.
            </p>
          ) : null}

          {!demolishMode && selectedTileCoords && cityRef.current ? (
            (() => {
              const stTile = getTile(
                cityRef.current,
                selectedTileCoords.tx,
                selectedTileCoords.ty
              );
              if (
                !stTile ||
                (!stTile.construction &&
                  (stTile.type === 'grass' ||
                    stTile.type === 'forest' ||
                    stTile.type === 'water'))
              ) {
                return null;
              }

              const onTollTile =
                isTollPlazaTile(cityRef.current, selectedTileCoords.tx, selectedTileCoords.ty) &&
                hud.tollPlaza.built;
              const onBorderPortal = isExternalBorderRoadTile(
                cityRef.current,
                selectedTileCoords.tx,
                selectedTileCoords.ty
              );
              const condoInfo =
                stTile.type === 'residential'
                  ? getCondoConversionInfo(
                      cityRef.current,
                      selectedTileCoords.tx,
                      selectedTileCoords.ty
                    )
                  : null;

              const stLabel = onTollTile
                ? 'Praça de Pedágio Rodoviário'
                : onBorderPortal
                  ? 'Rodovia Externa (Entrada / Saída)'
                  : stTile.type === 'road'
                    ? getRoadClassLabel(stTile.level || 1, stTile.variant || 0)
                    : stTile.type === 'bridge'
                      ? (stTile.level || 1) >= 4
                        ? isDoubleWidthBridgeTile(cityRef.current, stTile.x, stTile.y)
                          ? 'Megaponte Expressa de 2 Espaços (Nv. 4)'
                          : 'Megaponte Estaiada Expressa (Nv. 4)'
                        : (stTile.level || 1) === 3
                          ? 'Ponte Estaiada de Duas Faixas'
                          : (stTile.level || 1) === 2
                            ? 'Ponte de Arcos Dupla'
                            : (stTile.variant || 0) === 1
                              ? 'Ponte de Pedra Dupla'
                              : 'Ponte sobre o Rio'
                      : getZoneDisplayLabel(stTile);

              const activeConstructionStage = getTileConstructionStage(
                stTile.evolveFlash,
                stTile.type
              );
              const constructionBadge = stTile.construction
                ? `Obra em andamento (${Math.max(1, stTile.construction.totalMonths - stTile.construction.remainingMonths)}/${stTile.construction.totalMonths} meses)`
                : getConstructionStageLabel(activeConstructionStage);

              return (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-pixel text-[7px] text-[#ffe066] truncate">
                        LOTE ({selectedTileCoords.tx}, {selectedTileCoords.ty})
                        {stTile.type === 'residential' ||
                        stTile.type === 'commercial' ||
                        stTile.type === 'industrial'
                          ? ` · ${getNeighborhoodDistrictLabel(
                              getNeighborhoodDistrict(
                                cityRef.current,
                                selectedTileCoords.tx,
                                selectedTileCoords.ty
                              )
                            ).toUpperCase()}`
                          : ''}
                      </div>
                      <div className="text-[15.5px] font-bold text-[#eef2f7] leading-tight truncate">
                        {stLabel}
                      </div>
                      {constructionBadge ? (
                        <div className="text-[12.5px] font-bold text-[#72efdd] truncate">
                          {constructionBadge}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {!onTollTile && !onBorderPortal && !stTile.construction ? (
                        <button
                          type="button"
                          data-testid="confirm-demolish-selected"
                          onClick={() =>
                            handleDemolishAt(selectedTileCoords.tx, selectedTileCoords.ty)
                          }
                          className="pixel-btn px-2 py-1 bg-[#b83b3b] hover:bg-[#d94848] text-white font-pixel text-[7px] flex items-center gap-1"
                        >
                          <Hammer className="w-3 h-3" aria-hidden="true" />
                          <span>Demolir</span>
                        </button>
                      ) : null}
                      <button
                        type="button"
                        aria-label="Fechar seleção de lote"
                        onClick={() => setSelectedTileCoords(null)}
                        className="pixel-btn w-6 h-6 flex items-center justify-center bg-[#25314a] text-[#cfd9e8]"
                      >
                        <X className="w-3 h-3" aria-hidden="true" />
                      </button>
                    </div>
                  </div>

                  {onTollTile ? (
                    <div className="pixel-inset p-2 flex flex-col gap-1.5">
                      <div className="flex items-center justify-between text-[13.5px] tabular-nums">
                        <span className="text-[#9eb0c9]">
                          Visitantes:{' '}
                          <strong className="text-[#56c2ff]">
                            {hud.stats.visitorTrafficPct}%
                          </strong>
                        </span>
                        <span className="text-[#66d98c] font-bold">
                          +${hud.financials.revenue.tollIncome.toLocaleString('pt-BR')}/mês
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-1">
                        {TOLL_TARIFF_ORDER.map((tariff) => {
                          const cfg = TOLL_TARIFF_CONFIGS[tariff];
                          const active = hud.tollPlaza.tariff === tariff;
                          return (
                            <button
                              key={tariff}
                              type="button"
                              data-testid={`inspector-toll-${tariff}`}
                              onClick={() => handleSetTollTariff(tariff)}
                              className={`pixel-btn px-1.5 py-1 font-pixel text-[6.5px] uppercase ${
                                active
                                  ? 'bg-[#56c2ff] text-[#111622]'
                                  : 'bg-[#25314a] text-[#cfd9e8] hover:bg-[#314161]'
                              }`}
                            >
                              {cfg.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}

                  {onBorderPortal ? (
                    <div className="pixel-inset px-2 py-1 text-[13.5px] text-[#cfd9e8] tabular-nums">
                      Conexão regional permanente · Visitantes entrando/saindo:{' '}
                      <strong className="text-[#56c2ff]">
                        {hud.stats.visitorTrafficPct}%
                      </strong>
                    </div>
                  ) : null}

                  {!onTollTile &&
                  !onBorderPortal &&
                  (stTile.type === 'residential' ||
                    stTile.type === 'commercial' ||
                    stTile.type === 'industrial') ? (
                    (() => {
                      const mat = getNeighborhoodMaturity(
                        cityRef.current,
                        selectedTileCoords.tx,
                        selectedTileCoords.ty
                      );
                      const r12Pct = Math.round(mat.region12FillRatio * 100);
                      const minR12Pct = Math.round(URBAN_MATURITY_CONFIG.region12MinFillRatio * 100);
                      const lv = stTile.level || 1;
                      let evoHint = '';
                      if (lv === 1) {
                        evoHint = mat.region12AllLevel1
                          ? `Região 12×12 consolidada (${r12Pct}% · mín. ${minR12Pct}%) · Pronto p/ evoluir p/ Nv. 2`
                          : `Região 12×12 no Nv. 1: ${r12Pct}% (mín. ${minR12Pct}% p/ evoluir · ${mat.region12EmptyLots} lotes vazios)`;
                      } else if (lv === 2) {
                        evoHint =
                          hud.totalPopulation < URBAN_MATURITY_CONFIG.largeBuildingMinPopulation
                            ? `Prédios Grandes (Nv. 3) liberam aos ${URBAN_MATURITY_CONFIG.largeBuildingMinPopulation.toLocaleString('pt-BR')} hab.`
                            : mat.region12AllLevel1
                              ? `Região 12×12 consolidada (${r12Pct}%) · Elegível p/ Prédio Grande (Nv. 3)`
                              : `Região 12×12: ${r12Pct}% (alcance ${minR12Pct}% ocupação)`;
                      } else if (lv === 3 && (stTile.type === 'residential' || stTile.type === 'commercial')) {
                        evoHint =
                          hud.totalPopulation < URBAN_MATURITY_CONFIG.skyscraperMinPopulation
                            ? `Arranha-céus 2×2 (Nv. 4) liberam aos ${URBAN_MATURITY_CONFIG.skyscraperMinPopulation.toLocaleString('pt-BR')} hab. + Av. Larga 2×2`
                            : 'Metrópole 30k ativa · Arranha-céu 2×2 requer Av. Larga 2×2 ao lado';
                      }
                      if (!evoHint) return null;
                      return (
                        <div className="pixel-inset px-2 py-1 text-[12.5px] text-[#cfd9e8] leading-snug">
                          {evoHint}
                        </div>
                      );
                    })()
                  ) : null}

                  {condoInfo ? (
                    <div className="pixel-inset p-2 flex flex-col gap-1.5">
                      <div className="flex items-center justify-between gap-2 text-[13.5px] tabular-nums">
                        <span className="text-[#cfd9e8]">
                          → <strong className="text-[#ffe066]">{condoInfo.targetLabel}</strong>
                        </span>
                        <span className="text-[#66d98c] font-bold">
                          +{condoInfo.popGain.toLocaleString('pt-BR')} hab.
                        </span>
                      </div>
                      <button
                        type="button"
                        data-testid="convert-condo-btn"
                        disabled={!condoInfo.eligible || !condoInfo.canAfford}
                        onClick={() =>
                          handleConvertCondoAt(selectedTileCoords.tx, selectedTileCoords.ty)
                        }
                        className={`pixel-btn w-full px-2.5 py-1.5 font-pixel text-[7px] flex items-center justify-between gap-2 ${
                          condoInfo.eligible && condoInfo.canAfford
                            ? 'bg-[#2e7d57] hover:bg-[#379467] text-white'
                            : 'bg-[#2a3346] text-[#8394ad] cursor-not-allowed'
                        }`}
                      >
                        <span className="flex items-center gap-1">
                          <Building2 className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>CONVERTER EM CONDOMÍNIO</span>
                        </span>
                        <span>${condoInfo.cost.toLocaleString('pt-BR')}</span>
                      </button>
                      {!condoInfo.eligible && condoInfo.reason ? (
                        <div className="text-[12.5px] text-[#f5b73b] leading-tight">
                          {condoInfo.reason}
                        </div>
                      ) : !condoInfo.canAfford ? (
                        <div className="text-[12.5px] text-[#f5b73b] leading-tight">
                          Caixa insuficiente (precisa de ${condoInfo.cost.toLocaleString('pt-BR')}).
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })()
          ) : null}

          {demolishFeedback ? (
            <div className="flex items-center justify-between gap-2 text-[14px] text-[#ffe066]">
              <span>{demolishFeedback}</span>
              <button
                type="button"
                aria-label="Fechar aviso de demolição"
                onClick={() => setDemolishFeedback(null)}
                className="text-[#9eb0c9] hover:text-white"
              >
                <X className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Compact 3D Isometric Camera Dock (Intact Zoom / Fit / Rotate 90° / Reset + Demolir Tool) */}
      {screenState === 'playing' ? (
        <div
          role="group"
          aria-label="Controles de câmera 3D e zoom"
          className="fixed bottom-[104px] right-2 md:bottom-3 md:right-3 z-20 pixel-panel-glass px-1.5 py-1 flex items-center gap-1 select-none"
        >
          <button
            type="button"
            data-testid="toggle-lighting-btn"
            aria-label="Alternar iluminação do dia, entardecer e noite"
            title="Iluminação: Auto / Dia / Entardecer / Noite (Tecla L)"
            onClick={(e) => {
              e.currentTarget.blur();
              handleCycleLighting();
            }}
            className={`pixel-btn px-1.5 sm:px-2 h-7 flex items-center gap-1 font-pixel text-[7px] whitespace-nowrap ${
              timeOfDay === 'night'
                ? 'bg-[#1e3a8a] text-[#fde68a]'
                : timeOfDay === 'dusk'
                  ? 'bg-[#7c2d12] text-[#fed7aa]'
                  : timeOfDay === 'day'
                    ? 'bg-[#2b6cb0] text-[#fffbeb]'
                    : 'bg-[#25314a] text-[#cfd9e8] hover:bg-[#314161]'
            }`}
          >
            {timeOfDay === 'night' ? (
              <Moon className="w-3 h-3" aria-hidden="true" />
            ) : timeOfDay === 'dusk' ? (
              <Sunset className="w-3 h-3" aria-hidden="true" />
            ) : (
              <Sun className="w-3 h-3" aria-hidden="true" />
            )}
            <span className="hidden sm:inline">
              {timeOfDay === 'auto'
                ? 'Ciclo'
                : timeOfDay === 'day'
                  ? 'Dia'
                  : timeOfDay === 'dusk'
                    ? 'Tarde'
                    : 'Noite'}
            </span>
          </button>

          <span className="text-[#334361] mx-0.5" aria-hidden="true">
            |
          </span>

          <button
            type="button"
            data-testid="toggle-demolish-btn"
            aria-pressed={demolishMode}
            aria-label="Modo Demolir casa ou rua para reconstruir"
            title="Demolir casa, prédio, rua ou ponte para reconstruir (Tecla X)"
            onClick={(e) => {
              e.currentTarget.blur();
              setDemolishMode((prev) => !prev);
              setSelectedTileCoords(null);
              soundEngine.playSelect();
            }}
            className={`pixel-btn px-1.5 sm:px-2 h-7 flex items-center gap-1 font-pixel text-[7px] whitespace-nowrap ${
              demolishMode
                ? 'bg-[#e05252] text-white border-[#ffe066]'
                : 'bg-[#25314a] text-[#fca5a5] hover:bg-[#3b232e]'
            }`}
          >
            <Hammer className="w-3 h-3" aria-hidden="true" />
            <span>Demolir</span>
          </button>

          <span className="text-[#334361] mx-0.5" aria-hidden="true">
            |
          </span>

          <button
            type="button"
            disabled={zoomUi <= MIN_ZOOM + 0.02}
            aria-label="Afastar câmera (Zoom -)"
            title="Afastar câmera (-)"
            onClick={(e) => {
              e.currentTarget.blur();
              handleZoomStep(1 / 1.25);
            }}
            className="pixel-btn w-7 h-7 flex items-center justify-center bg-[#25314a] text-[#eef2f7] hover:bg-[#314161]"
          >
            <ZoomOut className="w-3.5 h-3.5" aria-hidden="true" />
          </button>

          <span
            data-testid="camera-zoom-label"
            className="px-1 text-[15px] text-[#ffe066] tabular-nums min-w-[40px] text-center"
            title="Nível de aproximação"
          >
            {zoomPercent}%
          </span>

          <button
            type="button"
            disabled={zoomUi >= MAX_ZOOM - 0.02}
            aria-label="Aproximar câmera (Zoom +)"
            title="Aproximar câmera (+)"
            onClick={(e) => {
              e.currentTarget.blur();
              handleZoomStep(1.25);
            }}
            className="pixel-btn w-7 h-7 flex items-center justify-center bg-[#25314a] text-[#eef2f7] hover:bg-[#314161]"
          >
            <ZoomIn className="w-3.5 h-3.5" aria-hidden="true" />
          </button>

          <span className="text-[#334361] mx-0.5" aria-hidden="true">
            |
          </span>

          <button
            type="button"
            aria-label="Ver cidade inteira de longe"
            title="Ver mapa inteiro de longe"
            onClick={(e) => {
              e.currentTarget.blur();
              handleFitOverview();
            }}
            className="pixel-btn px-1.5 sm:px-2 h-7 flex items-center gap-1 bg-[#25314a] text-[#cfd9e8] hover:bg-[#314161] font-pixel text-[7px] whitespace-nowrap"
          >
            <Maximize2 className="w-3 h-3" aria-hidden="true" />
            <span className="hidden sm:inline">Mapa</span>
          </button>

          <button
            type="button"
            aria-label="Girar câmera 90 graus"
            title="Girar câmera 90° (Q/E)"
            onClick={(e) => {
              e.currentTarget.blur();
              handleRotateCamera(1);
            }}
            className="pixel-btn px-1.5 sm:px-2 h-7 flex items-center gap-1 bg-[#25314a] text-[#cfd9e8] hover:bg-[#314161] font-pixel text-[7px] whitespace-nowrap"
          >
            <RotateCw className="w-3 h-3" aria-hidden="true" />
            <span className="hidden sm:inline">Girar</span>
          </button>

          <button
            type="button"
            aria-label="Centralizar câmera"
            title="Centralizar câmera (0)"
            onClick={(e) => {
              e.currentTarget.blur();
              handleResetCamera();
            }}
            className="pixel-btn w-7 h-7 flex items-center justify-center bg-[#25314a] text-[#cfd9e8] hover:bg-[#314161]"
          >
            <Compass className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      ) : null}

      {/* Responsive Fixed Tab Navigation (Left Rail on Desktop, Bottom Nav on Mobile) */}
      {screenState !== 'title' ? (
        <NavMenu
          activeModal={activeModal}
          criticalNeedsCount={criticalNeedsCount}
          financesBadge={financesBadge}
          worksBadge={worksBadge}
          onToggleTab={handleToggleModalTab}
        />
      ) : null}

      {/* Discreet Bottom News Ticker (Above Bottom Nav on Mobile) */}
      {screenState !== 'title' ? <NewsTicker news={hud.news} /> : null}

      {/* 4 Management Modals */}
      {screenState === 'playing' && activeModal === 'budget' ? (
        <BudgetModal
          hud={hud}
          onSetBudget={handleSetBudget}
          onSetBudgetTargetPct={handleSetBudgetTargetPct}
          onSetCondoPolicy={handleSetCondoPolicy}
          onClose={() => setActiveModal(null)}
        />
      ) : null}

      {screenState === 'playing' && activeModal === 'finances' ? (
        <FinancesModal
          hud={hud}
          onSetTaxRate={handleSetTaxRate}
          onSetTollTariff={handleSetTollTariff}
          onClose={() => setActiveModal(null)}
        />
      ) : null}

      {screenState === 'playing' && activeModal === 'emergencies' ? (
        <EmergenciesModal
          hud={hud}
          feedbackMsg={emergencyFeedback}
          onExecuteAction={handleExecuteEmergency}
          onExpandLand={handleExpandLand}
          onClose={() => {
            setEmergencyFeedback(null);
            setActiveModal(null);
          }}
        />
      ) : null}

      {screenState === 'playing' && activeModal === 'report' ? (
        <ReportModal
          hud={hud}
          onNavigateNeed={handleNavigateNeed}
          onClose={() => setActiveModal(null)}
        />
      ) : null}

      {/* Saved Cities Library & JSON Backup Modal (from Pause Menu) */}
      {savesModalOpen ? (
        <SavesModal
          hud={hud}
          savedGames={savedGames}
          feedbackMsg={savesFeedback}
          onSaveCurrentAs={handleSaveCurrentAs}
          onLoadGame={handleLoadSavedGame}
          onDeleteGame={handleDeleteSavedGame}
          onExportCode={handleExportSaveCode}
          onImportCode={handleImportSaveCode}
          onClose={() => {
            setSavesFeedback(null);
            setSavesModalOpen(false);
          }}
        />
      ) : null}

      {/* Title Screen Overlay (Novo Jogo / Carregar Jogo) */}
      {screenState === 'title' ? (
        <TitleOverlay
          seed={hud.seed}
          cityName={newCityName}
          trait={hud.trait}
          difficulty={selectedDifficulty}
          savedGames={savedGames}
          onChangeCityName={handleChangeTitleCityName}
          onSelectDifficulty={handleSelectTitleDifficulty}
          onStart={handleStartGame}
          onRerollSeed={handleNewCity}
          onLoadSavedGame={handleLoadSavedGame}
          onDeleteSavedGame={handleDeleteSavedGame}
        />
      ) : null}

      {/* Pause Menu Modal (Escape / P when no management modal is open) */}
      {screenState === 'paused' && !savesModalOpen && !returnMenuOpen ? (
        <PauseModal
          hud={hud}
          justSaved={justSaved}
          onChangeDifficulty={handleChangeLiveDifficulty}
          onResume={() => {
            document.body.dataset.state = 'playing';
            setScreenState('playing');
          }}
          onQuickSave={handleQuickSave}
          onOpenSaves={handleOpenSaves}
          onRequestReturnMenu={handleRequestReturnMenu}
        />
      ) : null}

      {/* Return to Main Menu Confirmation Modal (Salvar e Sair / Sair sem Salvar) */}
      {returnMenuOpen && screenState !== 'title' ? (
        <ReturnMenuModal
          hud={hud}
          onSaveAndExit={handleSaveAndExit}
          onExitWithoutSaving={handleExitWithoutSaving}
          onCancel={() => setReturnMenuOpen(false)}
        />
      ) : null}
    </div>
  );
}
