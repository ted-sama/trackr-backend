/**
 * Genre translations mapping
 * Keys are the genre names as stored in the database (English)
 * Values contain translations for each supported language
 *
 * Generated from unique genres in database
 */
export const genreTranslations: Record<string, Record<string, string>> = {
  // === GENRES FROM DATABASE ===

  // Action & Adventure
  'Action': { en: 'Action', fr: 'Action' },
  'Adventure': { en: 'Adventure', fr: 'Aventure' },
  'Martial Arts': { en: 'Martial Arts', fr: 'Arts martiaux' },
  'Samurai': { en: 'Samurai', fr: 'Samouraï' },
  'Super Power': { en: 'Super Power', fr: 'Super-pouvoirs' },
  'Survival': { en: 'Survival', fr: 'Survie' },

  // Comedy & Humor
  'Comedy': { en: 'Comedy', fr: 'Comédie' },
  'Gag Humor': { en: 'Gag Humor', fr: 'Humour gag' },
  'Parody': { en: 'Parody', fr: 'Parodie' },

  // Drama & Emotions
  'Drama': { en: 'Drama', fr: 'Drame' },
  'Romance': { en: 'Romance', fr: 'Romance' },
  'Love Polygon': { en: 'Love Polygon', fr: 'Triangle amoureux' },
  'Love Status Quo': { en: 'Love Status Quo', fr: 'Romance statique' },

  // Fantasy & Supernatural
  'Fantasy': { en: 'Fantasy', fr: 'Fantasy' },
  'Urban Fantasy': { en: 'Urban Fantasy', fr: 'Urban Fantasy' },
  'Supernatural': { en: 'Supernatural', fr: 'Surnaturel' },
  'Mythology': { en: 'Mythology', fr: 'Mythologie' },
  'Vampire': { en: 'Vampire', fr: 'Vampire' },
  'Isekai': { en: 'Isekai', fr: 'Isekai' },
  'Reincarnation': { en: 'Reincarnation', fr: 'Réincarnation' },
  'Time Travel': { en: 'Time Travel', fr: 'Voyage dans le temps' },
  'Mahou Shoujo': { en: 'Mahou Shoujo', fr: 'Magical Girl' },
  'Magical Sex Shift': { en: 'Magical Sex Shift', fr: 'Changement de sexe magique' },

  // Sci-Fi & Technology
  'Sci-Fi': { en: 'Sci-Fi', fr: 'SF' },
  'Mecha': { en: 'Mecha', fr: 'Mecha' },
  'Space': { en: 'Space', fr: 'Espace' },
  'Video Game': { en: 'Video Game', fr: 'Jeux vidéo' },

  // Horror & Dark themes
  'Horror': { en: 'Horror', fr: 'Horreur' },
  'Gore': { en: 'Gore', fr: 'Gore' },
  'Psychological': { en: 'Psychological', fr: 'Psychologique' },
  'Suspense': { en: 'Suspense', fr: 'Suspense' },

  // Mystery & Crime
  'Mystery': { en: 'Mystery', fr: 'Mystère' },
  'Detective': { en: 'Detective', fr: 'Détective' },
  'Organized Crime': { en: 'Organized Crime', fr: 'Crime organisé' },

  // Slice of Life & Daily Life
  'Slice of Life': { en: 'Slice of Life', fr: 'Tranche de vie' },
  'Iyashikei': { en: 'Iyashikei', fr: 'Iyashikei' },
  'CGDCT': { en: 'CGDCT', fr: 'CGDCT' },
  'Workplace': { en: 'Workplace', fr: 'Vie professionnelle' },
  'Childcare': { en: 'Childcare', fr: "Garde d'enfants" },
  'Pets': { en: 'Pets', fr: 'Animaux de compagnie' },

  // School & Youth
  'School': { en: 'School', fr: 'École' },
  'Delinquents': { en: 'Delinquents', fr: 'Délinquants' },

  // Demographics
  'Shounen': { en: 'Shounen', fr: 'Shonen' },
  'Shoujo': { en: 'Shoujo', fr: 'Shojo' },
  'Seinen': { en: 'Seinen', fr: 'Seinen' },
  'Josei': { en: 'Josei', fr: 'Josei' },
  'Kids': { en: 'Kids', fr: 'Enfants' },

  // Romance subgenres
  'Harem': { en: 'Harem', fr: 'Harem' },
  'Reverse Harem': { en: 'Reverse Harem', fr: 'Harem inversé' },
  'Boys Love': { en: 'Boys Love', fr: 'Boys Love' },
  'Girls Love': { en: 'Girls Love', fr: 'Girls Love' },
  'Ecchi': { en: 'Ecchi', fr: 'Ecchi' },
  'Erotica': { en: 'Erotica', fr: 'Érotique' },
  'Hentai': { en: 'Hentai', fr: 'Hentai' },

  // Sports & Competition
  'Sports': { en: 'Sports', fr: 'Sport' },
  'Combat Sports': { en: 'Combat Sports', fr: 'Sports de combat' },
  'Team Sports': { en: 'Team Sports', fr: "Sports d'équipe" },
  'Racing': { en: 'Racing', fr: 'Course' },
  'Strategy Game': { en: 'Strategy Game', fr: 'Jeu de stratégie' },
  'High Stakes Game': { en: 'High Stakes Game', fr: 'Jeu à enjeux élevés' },

  // Arts & Entertainment
  'Music': { en: 'Music', fr: 'Musique' },
  'Performing Arts': { en: 'Performing Arts', fr: 'Arts du spectacle' },
  'Visual Arts': { en: 'Visual Arts', fr: 'Arts visuels' },
  'Idols (Female)': { en: 'Idols (Female)', fr: 'Idoles (Femmes)' },
  'Idols (Male)': { en: 'Idols (Male)', fr: 'Idoles (Hommes)' },
  'Showbiz': { en: 'Showbiz', fr: 'Showbiz' },
  'Otaku Culture': { en: 'Otaku Culture', fr: 'Culture otaku' },

  // Food
  'Gourmet': { en: 'Gourmet', fr: 'Gourmet' },

  // Military & Historical
  'Military': { en: 'Military', fr: 'Militaire' },
  'Historical': { en: 'Historical', fr: 'Historique' },

  // Character types
  'Adult Cast': { en: 'Adult Cast', fr: 'Casting adulte' },
  'Anthropomorphic': { en: 'Anthropomorphic', fr: 'Anthropomorphe' },
  'Crossdressing': { en: 'Crossdressing', fr: 'Travestissement' },
  'Villainess': { en: 'Villainess', fr: 'Méchante' },

  // Special categories
  'Avant Garde': { en: 'Avant Garde', fr: 'Avant-garde' },
  'Award Winning': { en: 'Award Winning', fr: 'Primé' },
  'Educational': { en: 'Educational', fr: 'Éducatif' },
  'Memoir': { en: 'Memoir', fr: 'Mémoires' },
  'Medical': { en: 'Medical', fr: 'Médical' },

  // === ADDITIONAL GENRES (not in DB but common) ===

  // Variants/Aliases
  'Shonen': { en: 'Shonen', fr: 'Shonen' },
  'Shojo': { en: 'Shojo', fr: 'Shojo' },
  'Science Fiction': { en: 'Science Fiction', fr: 'Science-Fiction' },
  'Thriller': { en: 'Thriller', fr: 'Thriller' },
  'Crime': { en: 'Crime', fr: 'Policier' },
  'School Life': { en: 'School Life', fr: 'Vie scolaire' },
  'Yaoi': { en: 'Yaoi', fr: 'Yaoi' },
  'Yuri': { en: 'Yuri', fr: 'Yuri' },

  // Other common genres
  'Historical Fiction': { en: 'Historical Fiction', fr: 'Fiction historique' },
  'Western': { en: 'Western', fr: 'Western' },
  'Kodomo': { en: 'Kodomo', fr: 'Kodomo' },
  'Psychological Thriller': { en: 'Psychological Thriller', fr: 'Thriller psychologique' },
  'Dark Fantasy': { en: 'Dark Fantasy', fr: 'Dark Fantasy' },
  'Tragedy': { en: 'Tragedy', fr: 'Tragédie' },
  'Card Game': { en: 'Card Game', fr: 'Jeu de cartes' },
  'Gaming': { en: 'Gaming', fr: 'Jeux vidéo' },
  'Cooking': { en: 'Cooking', fr: 'Cuisine' },
  'Food': { en: 'Food', fr: 'Gastronomie' },
  'War': { en: 'War', fr: 'Guerre' },
  'Satire': { en: 'Satire', fr: 'Satire' },
  'Post-Apocalyptic': { en: 'Post-Apocalyptic', fr: 'Post-apocalyptique' },
  'Dystopian': { en: 'Dystopian', fr: 'Dystopie' },
  'Utopian': { en: 'Utopian', fr: 'Utopie' },
  'Cyberpunk': { en: 'Cyberpunk', fr: 'Cyberpunk' },
  'Steampunk': { en: 'Steampunk', fr: 'Steampunk' },
  'Zombie': { en: 'Zombie', fr: 'Zombie' },
  'Werewolf': { en: 'Werewolf', fr: 'Loup-garou' },
  'Demons': { en: 'Demons', fr: 'Démons' },
  'Magic': { en: 'Magic', fr: 'Magie' },
  'Folklore': { en: 'Folklore', fr: 'Folklore' },
  'Ninja': { en: 'Ninja', fr: 'Ninja' },
  'Police': { en: 'Police', fr: 'Police' },
  'Space Opera': { en: 'Space Opera', fr: 'Space Opera' },

  // Non-fiction
  'Biography': { en: 'Biography', fr: 'Biographie' },
  'Autobiography': { en: 'Autobiography', fr: 'Autobiographie' },
  'Self-Help': { en: 'Self-Help', fr: 'Développement personnel' },
  'True Crime': { en: 'True Crime', fr: 'True Crime' },
  'History': { en: 'History', fr: 'Histoire' },
  'Science': { en: 'Science', fr: 'Science' },
  'Philosophy': { en: 'Philosophy', fr: 'Philosophie' },
  'Psychology': { en: 'Psychology', fr: 'Psychologie' },
  'Business': { en: 'Business', fr: 'Business' },
  'Economics': { en: 'Economics', fr: 'Économie' },
  'Politics': { en: 'Politics', fr: 'Politique' },
  'Travel': { en: 'Travel', fr: 'Voyage' },
  'Essay': { en: 'Essay', fr: 'Essai' },
  'Documentary': { en: 'Documentary', fr: 'Documentaire' },

  // Age categories
  'Adult': { en: 'Adult', fr: 'Adulte' },
  'Young Adult': { en: 'Young Adult', fr: 'Young Adult' },
  'New Adult': { en: 'New Adult', fr: 'New Adult' },
  'Children': { en: 'Children', fr: 'Enfants' },
  'Teen': { en: 'Teen', fr: 'Adolescent' },

  // Format/Style
  'Graphic Novel': { en: 'Graphic Novel', fr: 'Roman graphique' },
  'Manga': { en: 'Manga', fr: 'Manga' },
  'Manhwa': { en: 'Manhwa', fr: 'Manhwa' },
  'Manhua': { en: 'Manhua', fr: 'Manhua' },
  'Webtoon': { en: 'Webtoon', fr: 'Webtoon' },
  'Comic': { en: 'Comic', fr: 'Bande dessinée' },
  'Light Novel': { en: 'Light Novel', fr: 'Light Novel' },
  'Novel': { en: 'Novel', fr: 'Roman' },
  'Anthology': { en: 'Anthology', fr: 'Anthologie' },
  'Short Stories': { en: 'Short Stories', fr: 'Nouvelles' },
  'Poetry': { en: 'Poetry', fr: 'Poésie' },

  // Other
  'LGBTQ': { en: 'LGBTQ', fr: 'LGBTQ+' },
  'LGBTQ+': { en: 'LGBTQ+', fr: 'LGBTQ+' },
  'Queer': { en: 'Queer', fr: 'Queer' },
  'Family': { en: 'Family', fr: 'Famille' },
  'Friendship': { en: 'Friendship', fr: 'Amitié' },
  'Coming of Age': { en: 'Coming of Age', fr: "Passage à l'âge adulte" },
  'Inspirational': { en: 'Inspirational', fr: 'Inspirant' },
  'Religious': { en: 'Religious', fr: 'Religieux' },
  'Spiritual': { en: 'Spiritual', fr: 'Spirituel' },
}

/**
 * Supported languages for genre translations
 */
export const supportedLanguages = ['en', 'fr'] as const
export type SupportedLanguage = (typeof supportedLanguages)[number]

/**
 * Get translation for a genre
 * Falls back to the original genre name if no translation exists
 */
export function translateGenre(genre: string, lang: SupportedLanguage): string {
  const translations = genreTranslations[genre]
  if (translations && translations[lang]) {
    return translations[lang]
  }
  // Fallback to original genre name
  return genre
}

/**
 * Get all translations for all genres
 */
export function getAllGenreTranslations(): Record<string, Record<string, string>> {
  return genreTranslations
}
