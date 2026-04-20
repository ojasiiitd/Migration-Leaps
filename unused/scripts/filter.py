import pandas as pd

# Files
regions_file = "/Users/ojas/Desktop/MSR/Courses/Information Visualization/Project/unused/unique_regions_codes.csv"
countries_file = "/Users/ojas/Desktop/MSR/Courses/Information Visualization/Project/unused/countries.csv"
output_file = "/Users/ojas/Desktop/MSR/Courses/Information Visualization/Project/unused/non_country_regions.csv"

# Load data
regions_df = pd.read_csv(regions_file)
countries_df = pd.read_csv(countries_file)

# Normalize for safe matching (lowercase + strip)
regions_df["region_clean"] = regions_df["region"].str.strip().str.lower()
countries_df["country_clean"] = countries_df["Name"].str.strip().str.lower()

# Create set of country names
country_set = set(countries_df["country_clean"])

# Filter: keep only NON-countries
non_country_df = regions_df[
    ~regions_df["region_clean"].isin(country_set)
]

# Drop helper column
non_country_df = non_country_df[["region", "code"]]

# Save
non_country_df.to_csv(output_file, index=False)

print(f"Saved {len(non_country_df)} non-country regions to {output_file}")