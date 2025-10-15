Deux paires de dates dans cet historique :
 * Date debut et date fin qui correspondent à la date de création et de fermeture de la ligne d'historique
 * lien date debut et lien date fin qui correspondent au dates de certificat / qualification transmise par les organismes de qualification.

### Création d'une ligne d'historique :

Les lignes d'historique sont créées dans les cas suivants :
 * Nouvelle entreprise => Entreprise transmise pour la première fois par l'OQ avec ses liens
   * Le siret n'existe pas encore en BDD
 * Entreprise existante mais avec ligne courante fermée.
   * Création d'une ligne d'historique même si aucune modification par rapport aux données de la ligne précédente.
   * une entreprise suspendue puis réactivée par les Organismes.
 * Ajout d'une qualification => L'entreprise est déjà identiiée et se voit attribuer une nouvelle qualification (fichier lien)
   * Le siret existe éjà en BDD mais pas de lien avec le code qualification existant
 * Modification des données de l'entreprise
   * Le siret existe déjà
 * Modification des données de qualification (hors cas particulier de la mise à jour de la date de fin du certificat)

Pour chacun de ces cas-là la ligne d'historique créée est créée avec les informations suivantes :
 * Date debut = date du traitement
 * date fin = NULL
 * date lien début = date dans le fichier lien
 * lien date fin = date fournie par les OQ

Une ligne dont la date de fin = Null est considéré comme étant la ligne courante

### Fermeture d'une ligne d'historique

Les lignes sont fermées dans le cadre des cas suivants :
 * Modification de l'entreprise
 * Modification de l'information de qualification
 * Retrait d'un lien qualification
 * Radiation de l'entreprise

Dans ces cas là, les lignes courantes d'historique sont mises à jour de la façon suivante :
 * date fin = date du traitement - 1J
 * lien date fin = date du traitement -1J

### Cas particulier Modification uniquement de la date de fin de lien

 * Mise à jour de la ligne courante (date_fin = NULL) avec lien_date_debut et lien_date_fin = dates transmises
