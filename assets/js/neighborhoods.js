/* ==========================================================================
   SPOTTED — city + neighborhood data
   The neighborhood field is a free-text input with autocomplete, so anything
   missing here can still be typed. Add cities as you expand.
   ========================================================================== */

window.SPOTTED_CITIES = [
  {
    id: "nyc",
    label: "New York",
    neighborhoods: [
      // Manhattan
      "Lower East Side", "East Village", "West Village", "Greenwich Village",
      "SoHo", "NoHo", "Nolita", "Tribeca", "Chinatown", "Two Bridges",
      "Financial District", "Chelsea", "Flatiron", "Gramercy", "Murray Hill",
      "Koreatown", "Midtown East", "Midtown West", "Hell's Kitchen",
      "Hudson Yards", "Upper West Side", "Upper East Side", "Yorkville",
      "Morningside Heights", "Harlem", "East Harlem", "Washington Heights",
      "Inwood", "Roosevelt Island",
      // Brooklyn
      "Williamsburg", "East Williamsburg", "Greenpoint", "Bushwick",
      "Bedford-Stuyvesant", "Clinton Hill", "Fort Greene", "Downtown Brooklyn",
      "Brooklyn Heights", "DUMBO", "Boerum Hill", "Cobble Hill",
      "Carroll Gardens", "Gowanus", "Park Slope", "Prospect Heights",
      "Crown Heights", "Prospect Lefferts Gardens", "Windsor Terrace",
      "Sunset Park", "Bay Ridge", "Red Hook", "Ridgewood",
      // Queens
      "Long Island City", "Astoria", "Sunnyside", "Woodside", "Jackson Heights",
      "Elmhurst", "Forest Hills", "Flushing", "Rockaway Beach",
      // Bronx
      "Mott Haven", "Riverdale", "Fordham",
      "Staten Island"
    ]
  },
  {
    id: "la",
    label: "Los Angeles",
    neighborhoods: [
      "Silver Lake", "Echo Park", "Los Feliz", "Highland Park", "Eagle Rock",
      "Atwater Village", "Frogtown", "Downtown LA", "Arts District",
      "Chinatown", "Koreatown", "Hollywood", "West Hollywood",
      "East Hollywood", "Beverly Grove", "Fairfax", "Mid-City", "Mid-Wilshire",
      "Beverly Hills", "Century City", "Culver City", "Palms", "Mar Vista",
      "Venice", "Santa Monica", "Brentwood", "Westwood", "Sawtelle",
      "Marina del Rey", "Playa Vista", "Manhattan Beach", "El Segundo",
      "Pasadena", "Glendale", "Burbank", "Studio City", "North Hollywood",
      "Sherman Oaks", "Van Nuys", "Encino", "Woodland Hills", "Long Beach",
      "Inglewood", "Boyle Heights", "Leimert Park"
    ]
  },
  {
    id: "chi",
    label: "Chicago",
    neighborhoods: [
      "Wicker Park", "Bucktown", "Logan Square", "Humboldt Park",
      "West Town", "Ukrainian Village", "Noble Square", "River West",
      "West Loop", "Fulton Market", "The Loop", "South Loop", "River North",
      "Streeterville", "Gold Coast", "Old Town", "Lincoln Park",
      "Lakeview", "Wrigleyville", "Boystown", "Uptown", "Andersonville",
      "Edgewater", "Rogers Park", "Ravenswood", "Lincoln Square",
      "Avondale", "Irving Park", "Portage Park", "Pilsen", "Bridgeport",
      "Hyde Park", "Bronzeville"
    ]
  },
  {
    id: "sf",
    label: "San Francisco",
    neighborhoods: [
      "Mission", "Bernal Heights", "Noe Valley", "Castro", "Duboce Triangle",
      "Hayes Valley", "Lower Haight", "Haight-Ashbury", "Cole Valley",
      "NoPa", "Alamo Square", "Western Addition", "Japantown", "Pacific Heights",
      "Cow Hollow", "Marina", "Russian Hill", "Nob Hill", "North Beach",
      "Chinatown", "Financial District", "SoMa", "Mission Bay", "Dogpatch",
      "Potrero Hill", "Inner Sunset", "Outer Sunset", "Inner Richmond",
      "Outer Richmond", "Excelsior", "Oakland", "Berkeley"
    ]
  },
  {
    id: "mia",
    label: "Miami",
    neighborhoods: [
      "Wynwood", "Design District", "Little Haiti", "Edgewater", "Midtown",
      "Downtown Miami", "Brickell", "Coconut Grove", "Coral Gables",
      "Little Havana", "Allapattah", "South Beach", "Mid-Beach",
      "North Beach", "Surfside", "Bal Harbour", "Key Biscayne",
      "Fort Lauderdale"
    ]
  },
  {
    id: "atx",
    label: "Austin",
    neighborhoods: [
      "East Austin", "Cherrywood", "Mueller", "Hyde Park", "North Loop",
      "Downtown", "Rainey Street", "South Congress", "Bouldin Creek",
      "Zilker", "Travis Heights", "Clarksville", "Tarrytown", "Crestview",
      "Brentwood", "Allandale", "South Lamar", "Riverside"
    ]
  },
  {
    id: "bos",
    label: "Boston",
    neighborhoods: [
      "Back Bay", "South End", "Beacon Hill", "North End", "Seaport",
      "Fort Point", "Downtown", "Chinatown", "Fenway", "Allston",
      "Brighton", "Brookline", "Jamaica Plain", "Roslindale",
      "South Boston", "Charlestown", "Cambridge", "Somerville",
      "Central Square", "Harvard Square", "Davis Square"
    ]
  },
  {
    id: "dc",
    label: "Washington, DC",
    neighborhoods: [
      "Shaw", "Logan Circle", "U Street", "Columbia Heights", "Adams Morgan",
      "Mount Pleasant", "Petworth", "Bloomingdale", "NoMa", "Union Market",
      "H Street", "Capitol Hill", "Navy Yard", "The Wharf", "Dupont Circle",
      "Georgetown", "Foggy Bottom", "Glover Park", "Woodley Park",
      "Cleveland Park", "Arlington", "Alexandria"
    ]
  }
];
