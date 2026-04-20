"""
Clean and standardize population dataset

Steps:
1. Load population + country reference data
2. Standardize country names using fuzzy matching
3. Preserve 'World'
4. Filter data from 1989 onwards
5. Save cleaned dataset
"""

import pandas as pd
from rapidfuzz import process, fuzz

# -----------------------------
# File paths
# -----------------------------
POP_FILE = "/Users/ojas/Desktop/MSR/Courses/Information Visualization/Project/unused/population.csv"
COUNTRIES_FILE = "/Users/ojas/Desktop/MSR/Courses/Information Visualization/Project/unused/countries.csv"
OUTPUT_FILE = "/Users/ojas/Desktop/MSR/Courses/Information Visualization/Project/unused/population_cleaned.csv"

# -----------------------------
# Load data
# -----------------------------
pop_df = pd.read_csv(POP_FILE)
countries_df = pd.read_csv(COUNTRIES_FILE)

# Normalize column names (defensive programming)
pop_df.columns = pop_df.columns.str.strip()
countries_df.columns = countries_df.columns.str.strip()

# Extract country list (assumes first column has names)
country_list = countries_df.iloc[:, 0].dropna().unique().tolist()

# Ensure "World" is included
if "World" not in country_list:
    country_list.append("World")

# -----------------------------
# Fuzzy matching function
# -----------------------------
def match_country(name, choices, threshold=90):
    """
    Match a country name to the closest valid name using fuzzy matching.
    
    Args:
        name (str): Input country name
        choices (list): List of valid country names
        threshold (int): Minimum similarity score
        
    Returns:
        str: Best matched country name or original if no good match
    """
    if pd.isna(name):
        return name

    name = name.strip()

    # Keep "World" as-is
    if name.lower() == "world":
        return "World"

    match, score, _ = process.extractOne(
        name,
        choices,
        scorer=fuzz.token_sort_ratio
    )

    if score >= threshold:
        return match
    else:
        return name  # fallback (can later inspect these)

# -----------------------------
# Apply standardization
# -----------------------------
print("🔄 Standardizing country names using fuzzy matching...")

pop_df["Country Name Cleaned"] = pop_df["Country Name"].apply(
    lambda x: match_country(x, country_list)
)

# -----------------------------
# Filter year >= 1989
# -----------------------------
pop_df = pop_df[pop_df["Year"] >= 1989].copy()

# -----------------------------
# Optional: Check unmatched names
# -----------------------------
unmatched = pop_df[
    ~pop_df["Country Name Cleaned"].isin(country_list)
]["Country Name"].unique()

if len(unmatched) > 0:
    print("\n⚠️ Unmatched country names (review manually):")
    print(unmatched)

# -----------------------------
# Final formatting
# -----------------------------
# Replace original column
pop_df["Country Name"] = pop_df["Country Name Cleaned"]
pop_df.drop(columns=["Country Name Cleaned"], inplace=True)

# Sort for neatness
pop_df = pop_df.sort_values(by=["Country Name", "Year"])

# -----------------------------
# Save output
# -----------------------------
pop_df.to_csv(OUTPUT_FILE, index=False)

print(f"\n✅ Cleaned dataset saved to:\n{OUTPUT_FILE}")