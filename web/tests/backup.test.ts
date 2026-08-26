/**
 * Vérification de la sauvegarde : « est-ce que TOUT est dans le JSON ? »
 *
 * Le risque n'est pas le journal (visible immédiatement) mais les données
 * discrètes — notes de jour, jours non comptés, poids d'importance, expositions
 * au soleil, réglages — qu'on ne remarque perdues qu'après une restauration.
 * Le premier test rend l'oubli impossible : tout champ ajouté au store doit
 * être soit exporté, soit explicitement listé comme volontairement exclu.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { useStore } from '../src/store/store';
import { buildBackup, importBackup } from '../src/store/backup';
import { backupCounts, suspiciousLoss } from '../src/store/backupCounts';
import { FOOD_BY_ID } from '../src/nutrition/foods';

const banane = FOOD_BY_ID.get('banane')!;

/**
 * Champs du store délibérément ABSENTS de la sauvegarde, avec leur raison.
 * Ajouter une ligne ici est un choix conscient, pas un oubli.
 */
const EXCLUS: Record<string, string> = {
  cloudApiKey: 'secret : ne doit jamais sortir de l’appareil',
  cloudApiKeys: 'secrets : les clés de chaque fournisseur ne doivent jamais sortir de l’appareil',
  deviceId: 'identité de CET appareil : la restaurer ailleurs créerait deux appareils jumeaux pour la synchro',
  syncCursor: 'curseur de synchro propre à l’appareil',
  lastAutoSave: 'marqueur local de la sauvegarde du jour',
  bankSchemaVersion:
    'version de schéma, portée par le champ `version` du fichier et réimposée à l’import (cf. migrateToPersonalBank)',
};

beforeEach(() => {
  useStore.setState({
    entries: [],
    customFoods: [],
    favoriteMeals: [],
    sunExposures: [],
    mutedDays: {},
    dayNotes: {},
    nutrientImportance: {},
  });
});

describe('exhaustivité de la sauvegarde', () => {
  it('tout champ de données du store est exporté ou explicitement exclu', () => {
    const state = useStore.getState() as unknown as Record<string, unknown>;
    const champsDeDonnees = Object.keys(state).filter((k) => typeof state[k] !== 'function');

    const backup = buildBackup() as unknown as Record<string, unknown>;
    const exportes = new Set([...Object.keys(backup), ...Object.keys(backup.settings as object)]);

    const oublis = champsDeDonnees.filter((k) => !exportes.has(k) && !(k in EXCLUS));
    expect(
      oublis,
      `Champ(s) du store absents du JSON de sauvegarde : ${oublis.join(', ')}. ` +
        'Ajoutez-les à buildBackup()/importBackup(), ou justifiez-les dans EXCLUS.',
    ).toEqual([]);
  });

  it('les champs listés comme exclus le sont vraiment (liste à jour)', () => {
    const backup = buildBackup() as unknown as Record<string, unknown>;
    const exportes = new Set([...Object.keys(backup), ...Object.keys(backup.settings as object)]);
    for (const k of Object.keys(EXCLUS)) expect(exportes.has(k), `${k} est exporté alors qu'il est listé comme exclu`).toBe(false);
  });

  it('la clé API n’est nulle part dans le JSON', () => {
    useStore.setState({ cloudApiKey: 'sk-ant-secret-123' });
    expect(JSON.stringify(buildBackup())).not.toContain('sk-ant-secret-123');
  });
});

describe('aller-retour export → import', () => {
  it('restaure notes, jours non comptés, importances, soleil, pesées et réglages', () => {
    const s = useStore.getState();
    s.addFoodEntry(banane, 2, 'piece', '2026-07-20');
    s.setDayNote('2026-07-20', 'coup de soleil torse et dos');
    s.setDayMute('2026-07-20', true);
    s.setDayMute('2026-07-19', false); // jour vide compté (jeûne)
    s.setNutrientImportance('omega3', 2.5);
    s.addSunExposure({
      date: '2026-07-20',
      heure: '12:00',
      dureeMin: 30,
      ciel: 'ensoleille',
      peau: 'torse-nu',
      phenotype: 'blanc',
      creme: 'aucune',
    });
    const weightId = s.addWeightEntry({ date: '2026-07-20', heure: '08:00', aJeun: true, nu: true, poids: 66.1, source: 'manuel' });
    s.setWeightConfig({ objectifPoids: 68 });
    s.setProfile({ objectif: 'perte', deficitPct: 15 });
    useStore.setState({ extractionMode: 'claudecode', llmModel: 'modele-test' });

    const json = JSON.stringify(buildBackup());

    // Navigateur « neuf » : on vide tout ce qui doit revenir du fichier.
    useStore.setState({
      entries: [],
      weightEntries: [],
      sunExposures: [],
      mutedDays: {},
      dayNotes: {},
      nutrientImportance: {},
      extractionMode: 'rules',
      llmModel: 'autre-modele',
    });

    const resume = importBackup(json);
    const after = useStore.getState();

    expect(after.dayNotes['2026-07-20']).toBe('coup de soleil torse et dos');
    expect(after.mutedDays).toEqual({ '2026-07-20': true, '2026-07-19': false });
    expect(after.nutrientImportance.omega3).toBe(2.5);
    expect(after.sunExposures).toHaveLength(1);
    expect(after.weightEntries.find((w) => w.id === weightId)?.poids).toBe(66.1);
    expect(after.weightConfig.objectifPoids).toBe(68);
    expect(after.profile.deficitPct).toBe(15);
    expect(after.entries).toHaveLength(1);
    // Réglages : restaurés eux aussi (on ne veut pas les refaire à la main).
    expect(after.extractionMode).toBe('claudecode');
    expect(after.llmModel).toBe('modele-test');

    // Le résumé annonce ce qui est revenu, y compris les données discrètes.
    expect(resume).toContain('1 note(s) de jour');
    expect(resume).toContain('2 jour(s)');
  });

  it('recalcule les items depuis la base ACTUELLE (nutriments ajoutés depuis la sauvegarde)', () => {
    // Sauvegarde « d'avant » : l'item ne connaît pas la répartition des AG saturés.
    const vieux = JSON.stringify({
      app: 'foodrecorder',
      version: 1,
      entries: [
        {
          id: 'e1',
          date: '2026-07-20',
          createdAt: 1,
          transcript: '',
          source: 'manuel',
          items: [
            {
              id: 'i1',
              foodId: 'beurre',
              nomAffiche: 'Beurre',
              quantite: 20,
              unite: 'g',
              grams: 20,
              nutrients: { kcal: 149, agSatures: 11 },
              estimation: false,
              douteux: false,
            },
          ],
        },
      ],
      weightEntries: [],
    });
    importBackup(vieux);
    const item = useStore.getState().entries[0].items[0];
    // Sans recalcul, la clé serait absente → NaN affiché dans le bilan.
    expect(item.nutrients.agSaturesLdl).toBeGreaterThan(0);
    expect(item.nutrients.agSaturesStearique).toBeGreaterThan(0);
    expect(Number.isNaN(item.nutrients.agSaturesLdl)).toBe(false);
  });

  it('importe une vieille sauvegarde sans les champs récents (valeurs par défaut)', () => {
    const vieux = JSON.stringify({ app: 'foodrecorder', version: 1, entries: [], weightEntries: [] });
    expect(() => importBackup(vieux)).not.toThrow();
    const after = useStore.getState();
    expect(after.dayNotes).toEqual({});
    expect(after.mutedDays).toEqual({});
    expect(after.nutrientImportance).toEqual({});
  });

  it('un fichier qui n’est pas une sauvegarde est refusé', () => {
    expect(() => importBackup('{"app":"autre"}')).toThrow();
    expect(() => importBackup('pas du json')).toThrow();
  });

  it('des réglages bricolés n’injectent pas de clés arbitraires dans le store', () => {
    const piege = JSON.stringify({
      app: 'foodrecorder',
      version: 1,
      entries: [],
      weightEntries: [],
      settings: { cloudApiKey: 'sk-vole', llmModel: 'ok' },
    });
    importBackup(piege);
    expect(useStore.getState().cloudApiKey).not.toBe('sk-vole');
    expect(useStore.getState().llmModel).toBe('ok');
  });
});

describe('garde-fou anti-écrasement', () => {
  const vraie = { entries: new Array(130).fill(0), weightEntries: new Array(44).fill(0), dayNotes: { a: 'x', b: 'y' } };

  it('refuse une sauvegarde vierge par-dessus une vraie (cas du 30/07/2026)', () => {
    const vierge = { entries: [], weightEntries: new Array(41).fill(0) };
    const raison = suspiciousLoss(vierge, vraie);
    expect(raison).toContain('entries 130 → 0');
  });

  it('laisse passer une suppression normale de quelques entrées', () => {
    const apres = { ...vraie, entries: new Array(126).fill(0) };
    expect(suspiciousLoss(apres, vraie)).toBeNull();
  });

  it('laisse passer une sauvegarde qui grandit', () => {
    const apres = { ...vraie, entries: new Array(135).fill(0), sunExposures: new Array(3).fill(0) };
    expect(suspiciousLoss(apres, vraie)).toBeNull();
  });

  it('détecte aussi la perte des données discrètes (notes, jours réglés)', () => {
    const sansNotes = { ...vraie, dayNotes: {} };
    expect(suspiciousLoss(sansNotes, vraie)).toContain('notes 2 → 0');
  });

  it('compte les champs absents comme zéro (vieilles sauvegardes)', () => {
    expect(backupCounts({}).entries).toBe(0);
    expect(backupCounts({ entries: [1, 2] }).entries).toBe(2);
  });
});
