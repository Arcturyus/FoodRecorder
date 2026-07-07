import type { Food, FoodCategory, Nutrients, Unit } from './types';
import { EMPTY_NUTRIENTS } from './types';

/**
 * Base d'aliments curée — valeurs pour 100 g, approximations CIQUAL 2020 / USDA.
 * vitK2 et créatine : valeurs manuelles (littérature), absentes des tables officielles.
 * Les poids par pièce sont des moyennes ; le poids donné par l'utilisateur prime toujours.
 */

function f(
  id: string,
  nom: string,
  categorie: FoodCategory,
  aliases: string[],
  n: Partial<Nutrients>,
  opts: { piece?: number; unitGrams?: Partial<Record<Unit, number>> } = {},
): Food {
  return {
    id,
    nom,
    categorie,
    aliases,
    pieceGrams: opts.piece,
    unitGrams: opts.unitGrams,
    n: { ...EMPTY_NUTRIENTS, ...n },
  };
}

export const FOODS: Food[] = [
  // ============ FRUITS ============
  f('banane', 'Banane', 'fruit', ['bananes'], { kcal: 90, proteines: 0.9, glucides: 20, lipides: 0.3, fibres: 2.6, agSatures: 0.1, potassium: 360, magnesium: 28, calcium: 5, fer: 0.3, zinc: 0.2, sodium: 1, vitC: 9, vitB9: 20, vitA: 3, vitE: 0.3, vitK1: 0.5, selenium: 1 }, { piece: 120 }),
  f('pomme', 'Pomme', 'fruit', ['pommes'], { kcal: 52, proteines: 0.3, glucides: 12, lipides: 0.2, fibres: 2.4, potassium: 107, magnesium: 5, calcium: 6, fer: 0.1, sodium: 1, vitC: 4.6, vitB9: 3, vitA: 3, vitE: 0.2, vitK1: 2 }, { piece: 150 }),
  f('poire', 'Poire', 'fruit', ['poires'], { kcal: 57, proteines: 0.4, glucides: 12, lipides: 0.1, fibres: 3.1, potassium: 116, magnesium: 7, calcium: 9, vitC: 4, vitB9: 7, vitK1: 4.4 }, { piece: 170 }),
  f('abricot', 'Abricot', 'fruit', ['abricots'], { kcal: 48, proteines: 1.4, glucides: 9, lipides: 0.4, fibres: 2, potassium: 259, magnesium: 10, calcium: 13, fer: 0.4, vitC: 10, vitB9: 9, vitA: 96, vitE: 0.9, vitK1: 3.3 }, { piece: 45 }),
  f('peche', 'Pêche', 'fruit', ['peches', 'pêches'], { kcal: 39, proteines: 0.9, glucides: 8, lipides: 0.3, fibres: 1.5, potassium: 190, magnesium: 9, calcium: 6, vitC: 6.6, vitB9: 4, vitA: 16, vitE: 0.7, vitK1: 2.6 }, { piece: 150 }),
  f('nectarine', 'Nectarine', 'fruit', ['nectarines', 'brugnon', 'brugnons'], { kcal: 44, proteines: 1.1, glucides: 9, lipides: 0.3, fibres: 1.7, potassium: 201, vitC: 5.4, vitA: 17, vitE: 0.8 }, { piece: 140 }),
  f('orange', 'Orange', 'fruit', ['oranges'], { kcal: 47, proteines: 0.9, glucides: 9.3, lipides: 0.1, fibres: 2.4, potassium: 181, calcium: 40, magnesium: 10, vitC: 53, vitB9: 30, vitA: 11, vitE: 0.2 }, { piece: 150 }),
  f('clementine', 'Clémentine', 'fruit', ['clementines', 'clémentines', 'mandarine', 'mandarines'], { kcal: 47, proteines: 0.9, glucides: 10, lipides: 0.2, fibres: 1.7, potassium: 177, calcium: 30, vitC: 49, vitB9: 24, vitA: 11 }, { piece: 70 }),
  f('cerise', 'Cerise', 'fruit', ['cerises'], { kcal: 63, proteines: 1.1, glucides: 13, lipides: 0.2, fibres: 2.1, potassium: 222, magnesium: 11, vitC: 7, vitA: 3, vitK1: 2.1 }, { piece: 8, unitGrams: { poignee: 60, bol: 150 } }),
  f('mangue', 'Mangue', 'fruit', ['mangues'], { kcal: 60, proteines: 0.8, glucides: 13.5, lipides: 0.4, fibres: 1.6, potassium: 168, magnesium: 10, vitC: 36, vitB9: 43, vitA: 54, vitE: 0.9, vitK1: 4.2 }, { piece: 300 }),
  f('kiwi', 'Kiwi', 'fruit', ['kiwis'], { kcal: 61, proteines: 1.1, glucides: 12, lipides: 0.5, fibres: 3, potassium: 312, calcium: 34, magnesium: 17, vitC: 93, vitB9: 25, vitE: 1.5, vitK1: 40 }, { piece: 75 }),
  f('fraise', 'Fraise', 'fruit', ['fraises'], { kcal: 32, proteines: 0.7, glucides: 6, lipides: 0.3, fibres: 2, potassium: 153, calcium: 16, vitC: 59, vitB9: 24, vitK1: 2.2 }, { piece: 12, unitGrams: { bol: 150, poignee: 60 } }),
  f('framboise', 'Framboise', 'fruit', ['framboises'], { kcal: 52, proteines: 1.2, glucides: 7, lipides: 0.7, fibres: 6.5, potassium: 151, calcium: 25, magnesium: 22, vitC: 26, vitB9: 21, vitE: 0.9, vitK1: 7.8 }, { piece: 4, unitGrams: { bol: 125, poignee: 50 } }),
  f('myrtille', 'Myrtille', 'fruit', ['myrtilles'], { kcal: 57, proteines: 0.7, glucides: 12, lipides: 0.3, fibres: 2.4, potassium: 77, vitC: 9.7, vitK1: 19, vitE: 0.6 }, { piece: 2, unitGrams: { bol: 125, poignee: 50 } }),
  f('raisin', 'Raisin', 'fruit', ['raisins', 'grappe de raisin'], { kcal: 69, proteines: 0.7, glucides: 16, lipides: 0.2, fibres: 0.9, potassium: 191, vitC: 3, vitK1: 14.6 }, { piece: 5, unitGrams: { poignee: 80, bol: 150 } }),
  f('ananas', 'Ananas', 'fruit', ['ananas frais'], { kcal: 50, proteines: 0.5, glucides: 11, lipides: 0.1, fibres: 1.4, potassium: 109, magnesium: 12, vitC: 48, vitB9: 18 }, { unitGrams: { tranche: 80, piece: 900 } }),
  f('melon', 'Melon', 'fruit', ['melons'], { kcal: 34, proteines: 0.8, glucides: 7.4, lipides: 0.2, fibres: 0.9, potassium: 267, sodium: 16, vitC: 37, vitA: 169, vitB9: 21 }, { piece: 800, unitGrams: { tranche: 150 } }),
  f('pasteque', 'Pastèque', 'fruit', ['pasteques', 'pastèques'], { kcal: 30, proteines: 0.6, glucides: 7, lipides: 0.2, fibres: 0.4, potassium: 112, vitC: 8, vitA: 28 }, { unitGrams: { tranche: 300, piece: 4000 } }),
  f('citron', 'Citron', 'fruit', ['citrons', 'jus de citron'], { kcal: 29, proteines: 1.1, glucides: 6, lipides: 0.3, fibres: 2.8, potassium: 138, calcium: 26, vitC: 53 }, { piece: 100 }),
  f('pamplemousse', 'Pamplemousse', 'fruit', ['pamplemousses', 'pomelo'], { kcal: 42, proteines: 0.8, glucides: 9, lipides: 0.1, fibres: 1.6, potassium: 135, vitC: 31, vitA: 46 }, { piece: 300 }),
  f('prune', 'Prune', 'fruit', ['prunes', 'quetsche', 'mirabelle', 'mirabelles'], { kcal: 46, proteines: 0.7, glucides: 10, lipides: 0.3, fibres: 1.4, potassium: 157, vitC: 9.5, vitA: 17, vitK1: 6.4 }, { piece: 50 }),
  f('figue', 'Figue', 'fruit', ['figues'], { kcal: 74, proteines: 0.8, glucides: 16, lipides: 0.3, fibres: 2.9, potassium: 232, calcium: 35, magnesium: 17, vitC: 2, vitK1: 4.7 }, { piece: 50 }),
  f('datte', 'Datte', 'fruit', ['dattes'], { kcal: 282, proteines: 2.5, glucides: 64, lipides: 0.4, fibres: 8, potassium: 656, magnesium: 43, calcium: 39, fer: 1, vitB9: 19 }, { piece: 8 }),
  f('grenade', 'Grenade', 'fruit', ['grenades'], { kcal: 83, proteines: 1.7, glucides: 14, lipides: 1.2, fibres: 4, potassium: 236, vitC: 10, vitB9: 38, vitK1: 16 }, { piece: 250 }),
  f('avocat', 'Avocat', 'fruit', ['avocats'], { kcal: 160, proteines: 2, glucides: 1.8, lipides: 14.7, fibres: 6.7, agSatures: 2.1, potassium: 485, magnesium: 29, vitC: 10, vitB9: 81, vitE: 2.1, vitK1: 21 }, { piece: 140 }),
  f('compote', 'Compote de pomme', 'fruit', ['compotes', 'compote de pommes', 'gourde de compote'], { kcal: 68, proteines: 0.2, glucides: 16, lipides: 0.1, fibres: 1.7, vitC: 1 }, { unitGrams: { pot: 100, portion: 100, piece: 100 } }),

  // ============ LÉGUMES ============
  f('tomate', 'Tomate', 'legume', ['tomates', 'tomate cerise', 'tomates cerises'], { kcal: 18, proteines: 0.9, glucides: 3.5, lipides: 0.2, fibres: 1.2, potassium: 237, magnesium: 11, vitC: 14, vitA: 42, vitE: 0.5, vitK1: 7.9, vitB9: 15 }, { piece: 120 }),
  f('haricots-verts', 'Haricots verts (cuits)', 'legume', ['haricot vert', 'haricots vert'], { kcal: 35, proteines: 1.9, glucides: 5, lipides: 0.3, fibres: 4, potassium: 146, calcium: 44, magnesium: 18, fer: 0.7, vitC: 9.7, vitB9: 33, vitA: 35, vitK1: 47.5 }, { unitGrams: { assiette: 200, portion: 150 } }),
  f('carotte', 'Carotte', 'legume', ['carottes', 'carottes rapees', 'carottes râpées'], { kcal: 41, proteines: 0.9, glucides: 7, lipides: 0.2, fibres: 2.8, potassium: 320, sodium: 69, calcium: 33, vitA: 835, vitC: 6, vitK1: 13, vitB9: 19 }, { piece: 80 }),
  f('courgette', 'Courgette (cuite)', 'legume', ['courgettes'], { kcal: 17, proteines: 1.2, glucides: 2, lipides: 0.3, fibres: 1, potassium: 261, vitC: 13, vitB9: 24, vitA: 10, vitK1: 4.3 }, { piece: 250, unitGrams: { portion: 150 } }),
  f('brocoli', 'Brocoli (cuit)', 'legume', ['brocolis'], { kcal: 35, proteines: 2.4, glucides: 4, lipides: 0.4, fibres: 3.3, potassium: 293, calcium: 40, magnesium: 21, vitC: 65, vitB9: 108, vitK1: 141, vitA: 77, vitE: 1.5, selenium: 1.6 }, { unitGrams: { portion: 150, assiette: 200 } }),
  f('epinards', 'Épinards (cuits)', 'legume', ['epinard', 'épinard'], { kcal: 23, proteines: 3, glucides: 1.4, lipides: 0.3, fibres: 2.4, potassium: 466, calcium: 136, magnesium: 87, fer: 3.6, vitA: 524, vitC: 10, vitB9: 146, vitK1: 494, vitE: 2.1 }, { unitGrams: { portion: 150, assiette: 200 } }),
  f('salade', 'Salade verte (laitue)', 'legume', ['laitue', 'salades', 'mache', 'mâche', 'roquette', 'batavia'], { kcal: 15, proteines: 1.4, glucides: 1.5, lipides: 0.2, fibres: 1.3, potassium: 247, calcium: 36, vitB9: 38, vitK1: 102, vitA: 25, vitC: 4 }, { unitGrams: { bol: 50, assiette: 80, portion: 60, poignee: 25 } }),
  f('concombre', 'Concombre', 'legume', ['concombres'], { kcal: 15, proteines: 0.7, glucides: 2.2, lipides: 0.1, fibres: 0.5, potassium: 147, vitC: 2.8, vitK1: 16 }, { piece: 400, unitGrams: { tranche: 7, portion: 100 } }),
  f('poivron', 'Poivron rouge', 'legume', ['poivrons', 'poivron vert', 'poivron jaune'], { kcal: 31, proteines: 1, glucides: 4.2, lipides: 0.3, fibres: 2.1, potassium: 211, vitC: 128, vitA: 157, vitE: 1.6, vitB9: 46 }, { piece: 150 }),
  f('champignon', 'Champignons de Paris', 'legume', ['champignons'], { kcal: 22, proteines: 3.1, glucides: 2.3, lipides: 0.3, fibres: 1, potassium: 318, zinc: 0.5, selenium: 9.3, vitB9: 17, vitD: 0.2 }, { piece: 15, unitGrams: { portion: 100 } }),
  f('oignon', 'Oignon', 'legume', ['oignons', 'echalote', 'échalote'], { kcal: 40, proteines: 1.1, glucides: 7.6, lipides: 0.1, fibres: 1.7, potassium: 146, calcium: 23, vitC: 7, vitB9: 19 }, { piece: 80 }),
  f('chou-fleur', 'Chou-fleur (cuit)', 'legume', ['choufleur', 'chou fleur'], { kcal: 24, proteines: 1.8, glucides: 2.8, lipides: 0.3, fibres: 2.3, potassium: 142, vitC: 44, vitB9: 44, vitK1: 13.8 }, { unitGrams: { portion: 150 } }),
  f('petits-pois', 'Petits pois (cuits)', 'legume', ['petit pois', 'pois'], { kcal: 84, proteines: 5.4, glucides: 12.6, lipides: 0.2, fibres: 5.5, potassium: 271, fer: 1.5, zinc: 1.2, magnesium: 39, vitC: 14, vitB9: 63, vitA: 38, vitK1: 25.9 }, { unitGrams: { portion: 150, assiette: 200 } }),
  f('mais', 'Maïs (boîte)', 'legume', ['mais doux', 'maïs doux'], { kcal: 96, proteines: 2.9, glucides: 16, lipides: 1.2, fibres: 2.4, potassium: 218, vitB9: 42, vitC: 5 }, { unitGrams: { cas: 20, portion: 100 } }),
  f('patate-douce', 'Patate douce (cuite)', 'legume', ['patates douces'], { kcal: 90, proteines: 2, glucides: 18.5, lipides: 0.2, fibres: 3.3, potassium: 475, magnesium: 27, calcium: 38, vitA: 961, vitC: 19.6, vitE: 0.7, vitB9: 6 }, { piece: 200 }),

  // ============ FÉCULENTS ============
  f('pomme-de-terre', 'Pomme de terre (cuite à l\'eau)', 'feculent', ['pommes de terre', 'patate', 'patates', 'pomme de terre vapeur'], { kcal: 87, proteines: 1.9, glucides: 19, lipides: 0.1, fibres: 1.8, potassium: 379, magnesium: 22, fer: 0.3, vitC: 13, vitB9: 10 }, { piece: 90, unitGrams: { assiette: 300, portion: 200 } }),
  f('riz-blanc', 'Riz blanc (cuit)', 'feculent', ['riz', 'riz basmati', 'riz thai', 'riz thaï'], { kcal: 130, proteines: 2.7, glucides: 28, lipides: 0.3, fibres: 0.4, potassium: 35, magnesium: 12, zinc: 0.5, fer: 0.2, selenium: 7.5, vitB9: 2 }, { unitGrams: { bol: 200, assiette: 250, portion: 180, cas: 25 } }),
  f('riz-complet', 'Riz complet (cuit)', 'feculent', ['riz brun'], { kcal: 112, proteines: 2.3, glucides: 23, lipides: 0.8, fibres: 1.8, magnesium: 44, potassium: 79, selenium: 9.8, vitB9: 7 }, { unitGrams: { bol: 200, assiette: 250, portion: 180 } }),
  f('pates', 'Pâtes (cuites)', 'feculent', ['pate', 'pâte', 'spaghetti', 'spaghettis', 'penne', 'coquillettes', 'tagliatelles', 'macaronis', 'fusilli'], { kcal: 131, proteines: 5, glucides: 25, lipides: 1.1, fibres: 1.8, potassium: 44, magnesium: 18, zinc: 0.5, selenium: 26, vitB9: 7 }, { unitGrams: { bol: 220, assiette: 280, portion: 200 } }),
  f('pates-completes', 'Pâtes complètes (cuites)', 'feculent', ['pates completes', 'pâtes complètes', 'pates integrales'], { kcal: 124, proteines: 5.3, glucides: 23.5, lipides: 1.1, fibres: 3.9, magnesium: 42, potassium: 62, zinc: 1.1, selenium: 26 }, { unitGrams: { bol: 220, assiette: 280, portion: 200 } }),
  f('baguette', 'Pain baguette', 'feculent', ['pain', 'pain blanc', 'demi baguette', 'morceau de pain'], { kcal: 270, proteines: 8.8, glucides: 55, lipides: 1.5, fibres: 2.7, sodium: 590, magnesium: 21, fer: 1, zinc: 0.8, selenium: 27, vitB9: 25 }, { piece: 250, unitGrams: { tranche: 30, portion: 60 } }),
  f('pain-complet', 'Pain complet', 'feculent', ['pain aux cereales', 'pain aux céréales', 'pain de campagne'], { kcal: 250, proteines: 10, glucides: 42, lipides: 3.5, fibres: 6.5, sodium: 450, magnesium: 60, fer: 2.3, zinc: 1.5, selenium: 30, vitB9: 40, vitE: 0.6 }, { unitGrams: { tranche: 35, portion: 70 } }),
  f('quinoa', 'Quinoa (cuit)', 'feculent', [], { kcal: 120, proteines: 4.4, glucides: 19, lipides: 1.9, fibres: 2.8, magnesium: 64, potassium: 172, fer: 1.5, zinc: 1.1, vitB9: 42, vitE: 0.6 }, { unitGrams: { bol: 185, assiette: 250, portion: 180 } }),
  f('semoule', 'Semoule (cuite)', 'feculent', ['couscous'], { kcal: 112, proteines: 3.8, glucides: 23, lipides: 0.2, fibres: 1.4, potassium: 58, selenium: 15 }, { unitGrams: { bol: 200, assiette: 250, portion: 180 } }),
  f('avoine', 'Flocons d\'avoine', 'feculent', ['flocon d\'avoine', 'porridge', 'oats'], { kcal: 379, proteines: 13.5, glucides: 58, lipides: 6.9, fibres: 10.4, agSatures: 1.2, magnesium: 138, potassium: 358, fer: 4, zinc: 3.6, calcium: 52, selenium: 29, vitB9: 32, vitE: 0.4 }, { unitGrams: { bol: 60, portion: 40, cas: 10 } }),
  f('lentilles', 'Lentilles (cuites)', 'feculent', ['lentille', 'lentilles vertes', 'lentilles corail'], { kcal: 116, proteines: 9, glucides: 17, lipides: 0.4, fibres: 7.9, fer: 3.3, magnesium: 36, potassium: 369, zinc: 1.3, selenium: 2.8, vitB9: 181 }, { unitGrams: { bol: 200, assiette: 250, portion: 200 } }),
  f('pois-chiches', 'Pois chiches (cuits)', 'feculent', ['pois chiche', 'houmous'], { kcal: 164, proteines: 8.9, glucides: 24, lipides: 2.6, fibres: 7.6, fer: 2.9, magnesium: 48, potassium: 291, zinc: 1.5, vitB9: 172, vitE: 0.4 }, { unitGrams: { bol: 200, portion: 180, cas: 25 } }),
  f('haricots-rouges', 'Haricots rouges (cuits)', 'feculent', ['haricot rouge'], { kcal: 127, proteines: 8.7, glucides: 19, lipides: 0.5, fibres: 6.4, fer: 2.9, magnesium: 45, potassium: 403, zinc: 1, vitB9: 130 }, { unitGrams: { bol: 200, portion: 180 } }),
  f('frites', 'Frites', 'feculent', ['frite', 'pommes frites'], { kcal: 290, proteines: 3.5, glucides: 36, lipides: 14, fibres: 3, agSatures: 2, potassium: 550, sodium: 250, vitC: 10 }, { unitGrams: { portion: 150, assiette: 250, poignee: 40 } }),

  // ============ VIANDES ============
  f('steak-hache-5', 'Steak haché 5% (cuit)', 'viande', ['steak hache 5%', 'steak haché 5 pour cent', 'steak 5%', 'boeuf hache 5%'], { kcal: 148, proteines: 26, glucides: 0, lipides: 4.5, agSatures: 2, fer: 2.6, zinc: 5, selenium: 17, potassium: 350, magnesium: 24, sodium: 72, vitB12: 2.6, vitB9: 8, vitD: 0.1, vitK2: 2, creatine: 0.4 }, { piece: 125 }),
  f('steak-hache-15', 'Steak haché 15% (cuit)', 'viande', ['steak hache', 'steak haché', 'steak', 'boeuf hache', 'bœuf haché', 'viande hachee', 'viande hachée'], { kcal: 230, proteines: 24, glucides: 0, lipides: 15, agSatures: 6.5, fer: 2.4, zinc: 4.8, selenium: 17, potassium: 320, sodium: 75, vitB12: 2.4, vitD: 0.1, vitK2: 2, creatine: 0.38 }, { piece: 125 }),
  f('entrecote', 'Entrecôte de bœuf (cuite)', 'viande', ['entrecote', 'boeuf', 'bœuf', 'steak de boeuf', 'faux filet', 'faux-filet', 'bavette', 'rumsteck'], { kcal: 240, proteines: 27, glucides: 0, lipides: 15, agSatures: 6.5, fer: 2.2, zinc: 4.5, selenium: 20, potassium: 330, sodium: 60, vitB12: 2.5, vitK2: 2, creatine: 0.4 }, { piece: 200 }),
  f('filet-poulet', 'Filet de poulet (cuit)', 'viande', ['blanc de poulet', 'escalope de poulet', 'poulet', 'filet de poulet grille'], { kcal: 165, proteines: 31, glucides: 0, lipides: 3.6, agSatures: 1, potassium: 256, magnesium: 29, selenium: 27.6, zinc: 1, sodium: 74, vitB12: 0.3, vitB9: 4, vitD: 0.1, vitK2: 9, creatine: 0.4 }, { piece: 150 }),
  f('cuisse-poulet', 'Cuisse de poulet (cuite)', 'viande', ['cuisses de poulet', 'haut de cuisse', 'pilon de poulet', 'poulet roti', 'poulet rôti'], { kcal: 215, proteines: 26, glucides: 0, lipides: 12, agSatures: 3.3, fer: 1.3, zinc: 2.4, selenium: 25, potassium: 240, sodium: 90, vitB12: 0.6, vitD: 0.2, vitK2: 25, creatine: 0.35 }, { piece: 130 }),
  f('aile-poulet', 'Aile de poulet (cuite)', 'viande', ['ailes de poulet', 'wings'], { kcal: 290, proteines: 27, glucides: 0, lipides: 19.5, agSatures: 5.5, zinc: 2, selenium: 24, sodium: 95, vitB12: 0.4, vitK2: 25, creatine: 0.3 }, { piece: 30 }),
  f('dinde', 'Escalope de dinde (cuite)', 'viande', ['dinde', 'filet de dinde', 'blanc de dinde'], { kcal: 150, proteines: 29, glucides: 0, lipides: 2, agSatures: 0.6, selenium: 30, zinc: 1.5, potassium: 250, sodium: 60, vitB12: 0.4, vitK2: 8, creatine: 0.4 }, { piece: 120 }),
  f('cote-porc', 'Côte de porc (cuite)', 'viande', ['porc', 'cote de porc', 'filet mignon', 'roti de porc', 'rôti de porc'], { kcal: 250, proteines: 27, glucides: 0, lipides: 15.5, agSatures: 5.8, zinc: 2.4, selenium: 38, fer: 0.9, potassium: 350, sodium: 60, vitB12: 0.7, vitD: 0.5, vitK2: 3, creatine: 0.45 }, { piece: 180 }),
  f('jambon-blanc', 'Jambon blanc', 'viande', ['jambon', 'tranche de jambon'], { kcal: 115, proteines: 20, glucides: 0.5, lipides: 3.5, agSatures: 1.2, sodium: 800, zinc: 1.6, selenium: 15, potassium: 300, vitB12: 0.7, vitK2: 2, creatine: 0.3 }, { piece: 45, unitGrams: { tranche: 45 } }),
  f('lardons', 'Lardons (cuits)', 'viande', ['lardon', 'bacon'], { kcal: 400, proteines: 16, glucides: 0.5, lipides: 37, agSatures: 13, sodium: 1200, zinc: 1.8, selenium: 20, vitB12: 0.5, vitK2: 5, creatine: 0.3 }, { unitGrams: { portion: 75, poignee: 50, cas: 20 } }),
  f('agneau', 'Gigot d\'agneau (cuit)', 'viande', ['gigot', 'cotelette d\'agneau', 'côtelette d\'agneau'], { kcal: 230, proteines: 26, glucides: 0, lipides: 14, agSatures: 6, fer: 1.8, zinc: 4.3, selenium: 20, sodium: 65, vitB12: 2.6, vitK2: 3, creatine: 0.4 }, { piece: 150 }),
  f('saucisse', 'Saucisse de Toulouse (cuite)', 'viande', ['saucisses', 'chipolata', 'chipolatas', 'saucisse de toulouse'], { kcal: 300, proteines: 16, glucides: 1, lipides: 26, agSatures: 9.5, sodium: 800, zinc: 1.8, vitB12: 1, vitK2: 5, creatine: 0.35 }, { piece: 100 }),
  f('merguez', 'Merguez (cuite)', 'viande', [], { kcal: 280, proteines: 15, glucides: 1, lipides: 24, agSatures: 9, sodium: 900, fer: 2, zinc: 2.5, vitB12: 1.5, creatine: 0.3 }, { piece: 60 }),

  // ============ POISSONS ============
  f('saumon', 'Saumon (cuit)', 'poisson', ['pave de saumon', 'pavé de saumon', 'saumon grille'], { kcal: 206, proteines: 22, glucides: 0, lipides: 13, agSatures: 2.5, potassium: 384, magnesium: 29, selenium: 41, iode: 12, sodium: 60, vitD: 10, vitB12: 2.8, vitB9: 26, vitE: 1.1, creatine: 0.45 }, { piece: 130 }),
  f('saumon-fume', 'Saumon fumé', 'poisson', ['tranche de saumon fume'], { kcal: 180, proteines: 23, glucides: 0, lipides: 10, agSatures: 2, sodium: 750, selenium: 35, iode: 15, vitD: 8, vitB12: 3, creatine: 0.4 }, { unitGrams: { tranche: 35, portion: 70 } }),
  f('thon-boite', 'Thon en boîte (au naturel)', 'poisson', ['thon', 'boite de thon', 'boîte de thon'], { kcal: 116, proteines: 26, glucides: 0, lipides: 1, agSatures: 0.3, sodium: 320, selenium: 70, iode: 12, fer: 1.4, vitB12: 2.5, vitD: 1.7, creatine: 0.4 }, { unitGrams: { piece: 112, portion: 80, cas: 25 } }),
  f('cabillaud', 'Cabillaud (cuit)', 'poisson', ['dos de cabillaud', 'colin', 'lieu', 'poisson blanc', 'merlu'], { kcal: 105, proteines: 23, glucides: 0, lipides: 0.9, agSatures: 0.2, selenium: 32, iode: 150, potassium: 300, sodium: 80, vitB12: 1.2, vitD: 1, creatine: 0.45 }, { piece: 130 }),
  f('sardines', 'Sardines en boîte (huile)', 'poisson', ['sardine', 'boite de sardines'], { kcal: 208, proteines: 24, glucides: 0, lipides: 11.5, agSatures: 1.5, calcium: 382, fer: 2.9, selenium: 52, iode: 30, sodium: 400, vitD: 4.8, vitB12: 8.9, vitE: 2, creatine: 0.4 }, { piece: 25, unitGrams: { portion: 90 } }),
  f('crevettes', 'Crevettes (cuites)', 'poisson', ['crevette', 'gambas'], { kcal: 99, proteines: 21, glucides: 0.2, lipides: 0.9, agSatures: 0.2, sodium: 380, selenium: 42, iode: 40, zinc: 1.6, fer: 0.5, vitB12: 1.7, vitD: 0.2, creatine: 0.2 }, { piece: 8, unitGrams: { portion: 100, poignee: 60 } }),

  // ============ ŒUFS & LAITAGES ============
  f('oeuf', 'Œuf (entier)', 'oeuf-laitier', ['oeufs', 'œuf', 'œufs', 'oeuf dur', 'oeuf au plat', 'oeufs brouilles', 'œufs brouillés', 'omelette'], { kcal: 140, proteines: 12.6, glucides: 0.7, lipides: 9.8, agSatures: 3.1, fer: 1.8, zinc: 1.3, selenium: 30, iode: 25, calcium: 56, potassium: 138, sodium: 140, vitA: 160, vitD: 2, vitB12: 1.1, vitB9: 47, vitE: 1, vitK1: 0.3, vitK2: 15 }, { piece: 55 }),
  f('fromage-blanc-0', 'Fromage blanc 0%', 'oeuf-laitier', ['fromage blanc 0 pour cent', 'fromage blanc zero'], { kcal: 47, proteines: 7.5, glucides: 4, lipides: 0.2, calcium: 110, potassium: 130, sodium: 35, iode: 20, vitB12: 0.4, vitB9: 10 }, { unitGrams: { pot: 100, portion: 100, bol: 200, cas: 30, piece: 100 } }),
  f('fromage-blanc', 'Fromage blanc 3%', 'oeuf-laitier', ['fromage blanc nature', 'faisselle'], { kcal: 78, proteines: 6.8, glucides: 3.5, lipides: 3.2, agSatures: 2.1, calcium: 105, potassium: 125, sodium: 35, iode: 20, vitB12: 0.4, vitA: 30 }, { unitGrams: { pot: 100, portion: 100, bol: 200, cas: 30, piece: 100 } }),
  f('yaourt-nature', 'Yaourt nature', 'oeuf-laitier', ['yaourt', 'yahourt', 'yogourt', 'yaourts'], { kcal: 60, proteines: 4, glucides: 4.8, lipides: 3, agSatures: 2, calcium: 140, potassium: 190, sodium: 45, iode: 25, selenium: 2, vitB12: 0.3 }, { piece: 125, unitGrams: { pot: 125 } }),
  f('yaourt-grec', 'Yaourt à la grecque', 'oeuf-laitier', ['yaourt grec'], { kcal: 120, proteines: 5.6, glucides: 4, lipides: 10, agSatures: 6.7, calcium: 110, sodium: 45, iode: 20, vitB12: 0.3 }, { piece: 150, unitGrams: { pot: 150 } }),
  f('skyr', 'Skyr', 'oeuf-laitier', [], { kcal: 57, proteines: 10, glucides: 4, lipides: 0.2, calcium: 110, sodium: 40, iode: 20, vitB12: 0.5 }, { piece: 140, unitGrams: { pot: 140, bol: 200 } }),
  f('lait-demi', 'Lait demi-écrémé', 'oeuf-laitier', ['lait', 'verre de lait'], { kcal: 46, proteines: 3.3, glucides: 4.8, lipides: 1.5, agSatures: 1, calcium: 114, potassium: 150, sodium: 43, iode: 25, selenium: 1.5, vitB12: 0.4, vitD: 0.4, vitA: 20 }, { unitGrams: { verre: 200, bol: 300, cas: 15 } }),
  f('lait-entier', 'Lait entier', 'oeuf-laitier', [], { kcal: 63, proteines: 3.2, glucides: 4.6, lipides: 3.6, agSatures: 2.3, calcium: 112, potassium: 145, sodium: 43, iode: 25, vitB12: 0.4, vitD: 0.5, vitA: 46 }, { unitGrams: { verre: 200, bol: 300 } }),
  f('emmental', 'Emmental', 'oeuf-laitier', ['gruyere', 'gruyère', 'comte', 'comté', 'fromage rape', 'fromage râpé', 'fromage'], { kcal: 380, proteines: 28.5, glucides: 1.5, lipides: 29.5, agSatures: 17.5, calcium: 970, sodium: 330, zinc: 4, selenium: 11, iode: 40, vitA: 200, vitD: 0.6, vitB12: 2.5, vitK2: 35 }, { unitGrams: { portion: 30, tranche: 20, cas: 10, poignee: 25, piece: 30 } }),
  f('camembert', 'Camembert', 'oeuf-laitier', ['brie', 'coulommiers'], { kcal: 280, proteines: 20, glucides: 0.5, lipides: 23, agSatures: 14.5, calcium: 460, sodium: 840, zinc: 2.4, iode: 25, vitA: 230, vitB12: 1.3, vitB9: 45, vitK2: 40 }, { unitGrams: { portion: 30, piece: 250, tranche: 25 } }),
  f('mozzarella', 'Mozzarella', 'oeuf-laitier', [], { kcal: 256, proteines: 18.6, glucides: 2, lipides: 19.5, agSatures: 12, calcium: 430, sodium: 500, zinc: 2.8, vitA: 180, vitB12: 1, vitK2: 20 }, { piece: 125, unitGrams: { portion: 60, tranche: 20 } }),
  f('parmesan', 'Parmesan', 'oeuf-laitier', ['grana padano', 'pecorino'], { kcal: 392, proteines: 35.7, glucides: 0.7, lipides: 26, agSatures: 17, calcium: 1180, sodium: 1600, zinc: 4, selenium: 22, vitA: 210, vitB12: 2, vitK2: 60 }, { unitGrams: { cas: 10, portion: 20, poignee: 20 } }),
  f('beurre', 'Beurre', 'matiere-grasse', ['beurre doux', 'beurre demi-sel', 'noisette de beurre'], { kcal: 745, proteines: 0.7, glucides: 0.6, lipides: 82, agSatures: 55, sodium: 11, vitA: 680, vitD: 1.5, vitE: 2, vitK1: 7, vitK2: 15 }, { unitGrams: { portion: 10, cas: 15, cac: 5, piece: 10 } }),
  f('creme-fraiche', 'Crème fraîche 30%', 'matiere-grasse', ['creme', 'crème', 'creme fraiche epaisse'], { kcal: 292, proteines: 2.3, glucides: 3, lipides: 30, agSatures: 20, calcium: 80, vitA: 270, vitD: 0.3, vitK2: 10 }, { unitGrams: { cas: 30, cac: 10, pot: 200, portion: 30 } }),

  // ============ SUCRÉ / SNACKS ============
  f('chocolat-noir-85', 'Chocolat noir 85%', 'sucre-snack', ['chocolat noir', 'chocolat 85', 'chocolat noir 85 pour cent', 'carre de chocolat noir'], { kcal: 590, proteines: 9.5, glucides: 24, lipides: 46, fibres: 12, agSatures: 28, magnesium: 230, fer: 11, potassium: 715, zinc: 3.3, calcium: 60, vitE: 0.6, vitK1: 7 }, { unitGrams: { carre: 10, piece: 10, tranche: 10, portion: 20 } }),
  f('chocolat-lait', 'Chocolat au lait', 'sucre-snack', ['chocolat', 'carre de chocolat au lait'], { kcal: 535, proteines: 7.3, glucides: 57, lipides: 30, fibres: 2.4, agSatures: 18.5, calcium: 190, magnesium: 63, potassium: 372, fer: 2.3, zinc: 1.5, vitB12: 0.4, vitE: 0.5 }, { unitGrams: { carre: 10, piece: 10, portion: 20 } }),
  f('petit-beurre', 'Biscuits petit-beurre', 'sucre-snack', ['petits beurres', 'biscuit', 'biscuits', 'petits gateaux', 'petits gâteaux', 'gateaux secs', 'gâteaux secs'], { kcal: 440, proteines: 7, glucides: 74, lipides: 11, fibres: 2.5, agSatures: 7, sodium: 300, calcium: 25, fer: 1.5 }, { piece: 8 }),
  f('cookie', 'Cookie', 'sucre-snack', ['cookies'], { kcal: 480, proteines: 5.5, glucides: 65, lipides: 22, fibres: 2, agSatures: 11, sodium: 350 }, { piece: 25 }),
  f('croissant', 'Croissant', 'sucre-snack', ['croissants'], { kcal: 406, proteines: 8, glucides: 45, lipides: 21, fibres: 2.6, agSatures: 11, sodium: 380, vitA: 100, vitE: 0.8 }, { piece: 60 }),
  f('pain-chocolat', 'Pain au chocolat', 'sucre-snack', ['pains au chocolat', 'chocolatine', 'chocolatines'], { kcal: 414, proteines: 7.5, glucides: 45, lipides: 22, fibres: 2.8, agSatures: 12, sodium: 350 }, { piece: 65 }),
  f('madeleine', 'Madeleine', 'sucre-snack', ['madeleines'], { kcal: 460, proteines: 6, glucides: 53, lipides: 25, fibres: 1.5, agSatures: 12, sodium: 300 }, { piece: 25 }),
  f('miel', 'Miel', 'sucre-snack', [], { kcal: 304, proteines: 0.3, glucides: 82 }, { unitGrams: { cas: 20, cac: 8, portion: 20 } }),
  f('confiture', 'Confiture', 'sucre-snack', ['confiture de fraise', 'confiture d\'abricot'], { kcal: 240, proteines: 0.5, glucides: 60, fibres: 1, vitC: 2 }, { unitGrams: { cas: 20, cac: 8, portion: 25 } }),
  f('sucre', 'Sucre', 'sucre-snack', ['sucre en poudre', 'morceau de sucre'], { kcal: 400, glucides: 100 }, { piece: 6, unitGrams: { cac: 5, cas: 10 } }),
  f('chips', 'Chips', 'sucre-snack', ['paquet de chips'], { kcal: 530, proteines: 6, glucides: 50, lipides: 33, fibres: 4, agSatures: 3.5, sodium: 530, potassium: 1200, vitC: 15, vitE: 5 }, { unitGrams: { poignee: 30, portion: 30, piece: 30 } }),
  f('glace', 'Glace (crème glacée)', 'sucre-snack', ['creme glacee', 'boule de glace'], { kcal: 200, proteines: 3.5, glucides: 24, lipides: 10, agSatures: 6.5, calcium: 120, vitA: 100 }, { unitGrams: { piece: 50, portion: 75, bol: 120, pot: 100 } }),

  // ============ MATIÈRES GRASSES / OLÉAGINEUX ============
  f('huile-olive', 'Huile d\'olive', 'matiere-grasse', ['huile', 'filet d\'huile d\'olive'], { kcal: 900, lipides: 100, agSatures: 14, vitE: 14, vitK1: 60 }, { unitGrams: { cas: 14, cac: 5, portion: 10 } }),
  f('amandes', 'Amandes', 'matiere-grasse', ['amande'], { kcal: 579, proteines: 21, glucides: 9.5, lipides: 50, fibres: 12.5, agSatures: 3.8, magnesium: 270, calcium: 269, potassium: 733, fer: 3.7, zinc: 3.1, vitE: 25.6, vitB9: 44 }, { piece: 1.2, unitGrams: { poignee: 30, portion: 30, cas: 15 } }),
  f('noix', 'Noix', 'matiere-grasse', ['cerneaux de noix', 'cerneau de noix'], { kcal: 654, proteines: 15, glucides: 7, lipides: 65, fibres: 6.7, agSatures: 6.1, magnesium: 158, potassium: 441, zinc: 3, vitE: 0.7, vitB9: 98, vitK1: 2.7 }, { piece: 7, unitGrams: { poignee: 30, portion: 30 } }),
  f('noisettes', 'Noisettes', 'matiere-grasse', ['noisette'], { kcal: 628, proteines: 15, glucides: 8, lipides: 61, fibres: 9.7, agSatures: 4.5, magnesium: 163, calcium: 114, fer: 4.7, vitE: 15, vitB9: 113 }, { piece: 1.5, unitGrams: { poignee: 30, portion: 30 } }),
  f('beurre-cacahuete', 'Beurre de cacahuète', 'matiere-grasse', ['beurre de cacahuetes', 'pate d\'arachide', 'peanut butter'], { kcal: 588, proteines: 25, glucides: 20, lipides: 50, fibres: 6, agSatures: 10, magnesium: 168, potassium: 649, zinc: 2.9, sodium: 17, vitE: 9, vitB9: 87 }, { unitGrams: { cas: 16, cac: 8, portion: 30 } }),

  // ============ BOISSONS ============
  f('jus-orange', 'Jus d\'orange', 'boisson', ['jus d\'oranges', 'jus orange'], { kcal: 45, proteines: 0.7, glucides: 10, potassium: 200, vitC: 33, vitB9: 25 }, { unitGrams: { verre: 200, bol: 300 } }),
  f('coca', 'Coca-Cola', 'boisson', ['soda', 'coca cola', 'canette de coca'], { kcal: 42, glucides: 10.6, sodium: 10 }, { piece: 330, unitGrams: { verre: 250 } }),
  f('biere', 'Bière', 'boisson', ['pinte', 'demi de biere', 'bieres'], { kcal: 43, proteines: 0.5, glucides: 3.5, potassium: 27, vitB9: 6 }, { unitGrams: { verre: 250, piece: 330 } }),
  f('vin-rouge', 'Vin rouge', 'boisson', ['vin', 'verre de vin'], { kcal: 83, glucides: 2.6, potassium: 127, fer: 0.7 }, { unitGrams: { verre: 120 } }),

  // ============ PLATS ============
  f('pizza', 'Pizza margherita', 'plat', ['pizzas', 'part de pizza'], { kcal: 230, proteines: 9, glucides: 28, lipides: 8.5, fibres: 2, agSatures: 3.5, sodium: 500, calcium: 150, vitB9: 20 }, { piece: 350, unitGrams: { portion: 125, tranche: 90, assiette: 350 } }),
  f('ketchup', 'Ketchup', 'autre', [], { kcal: 100, proteines: 1.2, glucides: 24, sodium: 900, potassium: 300, vitC: 4 }, { unitGrams: { cas: 15, cac: 5, portion: 15 } }),
  f('mayonnaise', 'Mayonnaise', 'autre', ['mayo'], { kcal: 690, proteines: 1.1, glucides: 1.5, lipides: 75, agSatures: 6, sodium: 600, vitE: 6 }, { unitGrams: { cas: 15, cac: 5, portion: 15 } }),
];

export const FOOD_BY_ID: Map<string, Food> = new Map(FOODS.map((x) => [x.id, x]));
