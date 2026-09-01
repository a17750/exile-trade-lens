using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.RegularExpressions;
using ExileTradeLens.Ggpk;
using LibBundledGGPK3;

Console.OutputEncoding = Encoding.UTF8;

const string BaseItemsEn = "data/balance/baseitemtypes.datc64";
const string BaseItemsTw = "data/balance/traditional chinese/baseitemtypes.datc64";
const string WordsEn = "data/balance/words.datc64";
const string WordsTw = "data/balance/traditional chinese/words.datc64";
const string ModsEn = "data/balance/mods.datc64";
const string ModsTw = "data/balance/traditional chinese/mods.datc64";
const string ClientStringsEn = "data/balance/clientstrings.datc64";
const string ClientStringsTw = "data/balance/traditional chinese/clientstrings.datc64";
const string PassiveSkillsEn = "data/balance/passiveskills.datc64";
const string PassiveSkillsTw = "data/balance/traditional chinese/passiveskills.datc64";
const string StatDescriptions = "data/statdescriptions/stat_descriptions.csd";
const string PassiveStatDescriptions = "data/statdescriptions/passive_skill_stat_descriptions.csd";
const int ModsExpectedRowSize = 677;
const int ModsIdOffset = 0;
const int ModsDomainOffset = 94;
const int ModsNameOffset = 98;
const int ModsGenerationTypeOffset = 106;
const int ItemModDomain = 1;
const int PrefixGenerationType = 1;
const int SuffixGenerationType = 2;

var options = CliOptions.Parse(args);
var repositoryRoot = Path.GetFullPath(options.RepositoryRoot);
var outputRoot = Path.GetFullPath(Path.IsPathRooted(options.OutputPath)
    ? options.OutputPath
    : Path.Combine(repositoryRoot, options.OutputPath));
EnsureInsideRepository(repositoryRoot, outputRoot);

var ggpkPath = Path.GetFullPath(options.GgpkPath);
if (!File.Exists(ggpkPath)) throw new FileNotFoundException("Content.ggpk not found", ggpkPath);
if (!string.Equals(Path.GetFileName(ggpkPath), "Content.ggpk", StringComparison.OrdinalIgnoreCase)) {
    throw new ArgumentException("--ggpk must point to Content.ggpk");
}

var before = SnapshotGameFile(ggpkPath);
Console.WriteLine($"Opening read-only: {ggpkPath}");
Console.WriteLine($"Size: {before.Length:N0} bytes; modified: {before.LastWriteTimeUtc:O}");

var requestedPaths = new[] {
    BaseItemsEn, BaseItemsTw, WordsEn, WordsTw, ModsEn, ModsTw,
    ClientStringsEn, ClientStringsTw, PassiveSkillsEn, PassiveSkillsTw,
    StatDescriptions, PassiveStatDescriptions,
};
var rawTables = new Dictionary<string, byte[]>(StringComparer.OrdinalIgnoreCase);

using (var stream = new FileStream(ggpkPath, new FileStreamOptions {
    Mode = FileMode.Open,
    Access = FileAccess.Read,
    Share = FileShare.Read,
    Options = FileOptions.RandomAccess,
})) {
    using var ggpk = new BundledGGPK(stream, leaveOpen: true, parsePathsInIndex: false);
    var failedPaths = ggpk.Index.ParsePaths();
    if (failedPaths > 0) Console.WriteLine($"Warning: {failedPaths} unrelated index paths could not be decoded.");

    var records = ggpk.Index.Files.Values
        .Where(record => requestedPaths.Contains(record.Path, StringComparer.OrdinalIgnoreCase))
        .ToDictionary(record => record.Path, StringComparer.OrdinalIgnoreCase);

    foreach (var path in requestedPaths) {
        if (!records.TryGetValue(path, out var record)) {
            throw new FileNotFoundException($"Required table not found inside GGPK: {path}");
        }
        rawTables[path] = record.Read().ToArray();
        Console.WriteLine($"Read: {path} ({rawTables[path].Length:N0} bytes)");
    }
}

var after = SnapshotGameFile(ggpkPath);
if (before != after) {
    throw new IOException("Content.ggpk metadata changed during extraction; no output was written.");
}
Console.WriteLine("Read-only check passed: Content.ggpk size and modified time are unchanged.");

var datTablePaths = requestedPaths.Where(path => !path.EndsWith(".csd", StringComparison.OrdinalIgnoreCase));
var tables = datTablePaths.ToDictionary(
    path => path,
    path => new Datc64Table(path, rawTables[path]),
    StringComparer.OrdinalIgnoreCase);

ValidatePair(tables[BaseItemsEn], tables[BaseItemsTw]);
ValidatePair(tables[WordsEn], tables[WordsTw]);
ValidatePair(tables[ModsEn], tables[ModsTw]);
ValidatePair(tables[ClientStringsEn], tables[ClientStringsTw]);
ValidatePair(tables[PassiveSkillsEn], tables[PassiveSkillsTw]);
if (tables[ModsEn].RowSize != ModsExpectedRowSize) {
    throw new InvalidDataException(
        $"Mods schema changed: expected row size {ModsExpectedRowSize}, got {tables[ModsEn].RowSize}. " +
        "Review poe-tool-dev/dat-schema offsets before extracting localized affix names.");
}

var baseResult = BuildBaseItems(tables[BaseItemsEn], tables[BaseItemsTw]);
var wordsResult = BuildWords(tables[WordsEn], tables[WordsTw]);
var affixResult = BuildAffixes(tables[ModsEn], tables[ModsTw]);
var clientStringResult = BuildClientStrings(tables[ClientStringsEn], tables[ClientStringsTw]);
var passiveResult = BuildPassiveSkills(tables[PassiveSkillsEn], tables[PassiveSkillsTw]);
var statDescriptionResult = BuildStatDescriptions(rawTables[StatDescriptions], rawTables[PassiveStatDescriptions]);
var generatedAt = DateTime.UtcNow.ToString("O");

Directory.CreateDirectory(outputRoot);
var baseItems = new {
    schemaVersion = 1,
    generatedAt,
    domain = "base-item",
    source = "paired-local-content-ggpk",
    records = baseResult.Records,
    byEnglish = baseResult.ByEnglish,
    conflicts = baseResult.Conflicts,
    coverage = baseResult.Coverage,
};
var words = new {
    schemaVersion = 1,
    generatedAt,
    domain = "word-component",
    source = "paired-local-content-ggpk",
    records = wordsResult.Records,
    byEnglish = wordsResult.ByEnglish,
    conflicts = wordsResult.Conflicts,
    coverage = wordsResult.Coverage,
};
var affixes = new {
    schemaVersion = 1,
    generatedAt,
    domain = "affix-name",
    source = "paired-local-content-ggpk",
    schema = new {
        reference = "poe-tool-dev/dat-schema",
        table = "Mods",
        validFor = "poe2",
        rowSize = ModsExpectedRowSize,
        idOffset = ModsIdOffset,
        domainOffset = ModsDomainOffset,
        nameOffset = ModsNameOffset,
        generationTypeOffset = ModsGenerationTypeOffset,
        includedDomain = "ITEM",
    },
    records = affixResult.Records,
    prefixes = affixResult.Prefixes.ByEnglish,
    suffixes = affixResult.Suffixes.ByEnglish,
    conflicts = new {
        prefixes = affixResult.Prefixes.Conflicts,
        suffixes = affixResult.Suffixes.Conflicts,
    },
    coverage = new {
        prefixes = affixResult.Prefixes.Coverage,
        suffixes = affixResult.Suffixes.Coverage,
        combinedUsablePercent = Percent(
            affixResult.Prefixes.ByEnglish.Count + affixResult.Suffixes.ByEnglish.Count,
            affixResult.Prefixes.Coverage.UniqueEnglish + affixResult.Suffixes.Coverage.UniqueEnglish),
    },
};
var clientStrings = new {
    schemaVersion = 1,
    generatedAt,
    domain = "client-string",
    source = "paired-local-content-ggpk",
    records = clientStringResult.Records,
    byId = clientStringResult.Records.ToDictionary(
        record => record.Id,
        record => new { record.English, record.ZhTW },
        StringComparer.Ordinal),
    byEnglish = clientStringResult.ByEnglish,
    conflicts = clientStringResult.Conflicts,
    coverage = clientStringResult.Coverage,
};
var passiveSkills = new {
    schemaVersion = 1,
    generatedAt,
    domain = "passive-skill",
    source = "paired-local-content-ggpk",
    schema = new { table = "PassiveSkills", idOffset = 0, nameOffset = 50 },
    records = passiveResult.Records,
    byEnglish = passiveResult.ByEnglish,
    conflicts = passiveResult.Conflicts,
    coverage = passiveResult.Coverage,
};
var statDescriptions = new {
    schemaVersion = 1,
    generatedAt,
    domain = "stat-description",
    source = "local-content-ggpk-csd",
    files = new[] { StatDescriptions, PassiveStatDescriptions },
    byEnglish = statDescriptionResult.ByEnglish,
    signedVariants = new {
        byPositiveEnglish = statDescriptionResult.SignedVariants,
        conflicts = statDescriptionResult.SignedConflicts,
    },
    conflicts = statDescriptionResult.Conflicts,
    coverage = statDescriptionResult.Coverage,
};

var manifest = new {
    schemaVersion = 1,
    generatedAt,
    source = "local-read-only-content-ggpk",
    gameFile = new {
        name = Path.GetFileName(ggpkPath),
        before.Length,
        before.LastWriteTimeUtc,
    },
    safety = new {
        fileAccess = "Read",
        fileShare = "Read",
        rawTablesWritten = false,
        gameDirectoryWritten = false,
    },
    tables = tables.Values.OrderBy(table => table.Path).Select(table => new {
        path = table.Path,
        table.RowCount,
        table.RowSize,
        table.Sha256,
    }).Concat(rawTables.Where(pair => pair.Key.EndsWith(".csd", StringComparison.OrdinalIgnoreCase)).Select(pair => new {
        path = pair.Key,
        RowCount = 0,
        RowSize = 0,
        Sha256 = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(pair.Value)).ToLowerInvariant(),
    })),
    coverage = new {
        baseItems = baseResult.Coverage,
        words = wordsResult.Coverage,
        affixes = new {
            prefixes = affixResult.Prefixes.Coverage,
            suffixes = affixResult.Suffixes.Coverage,
        },
        clientStrings = clientStringResult.Coverage,
        passiveSkills = passiveResult.Coverage,
        statDescriptions = statDescriptionResult.Coverage,
        combinedUsablePercent = Percent(
            baseResult.ByEnglish.Count + wordsResult.ByEnglish.Count +
                affixResult.Prefixes.ByEnglish.Count + affixResult.Suffixes.ByEnglish.Count +
                clientStringResult.ByEnglish.Count,
            baseResult.Coverage.UniqueEnglish + wordsResult.Coverage.UniqueEnglish +
                affixResult.Prefixes.Coverage.UniqueEnglish + affixResult.Suffixes.Coverage.UniqueEnglish +
                clientStringResult.Coverage.UniqueEnglish),
    },
};
WriteJsonAtomic(Path.Combine(outputRoot, "ggpk.json"), new {
    schemaVersion = 1,
    locale = "zh-TW",
    source = "local-read-only-content-ggpk",
    manifest,
    baseItems,
    words,
    affixes,
    clientStrings,
    passiveSkills,
    statDescriptions,
});

Console.WriteLine($"Base-item usable coverage: {baseResult.Coverage.UsablePercent:F2}%");
Console.WriteLine($"Word-component usable coverage: {wordsResult.Coverage.UsablePercent:F2}%");
Console.WriteLine($"Affix-prefix usable coverage: {affixResult.Prefixes.Coverage.UsablePercent:F2}%");
Console.WriteLine($"Affix-suffix usable coverage: {affixResult.Suffixes.Coverage.UsablePercent:F2}%");
Console.WriteLine($"Client-string usable coverage: {clientStringResult.Coverage.UsablePercent:F2}%");
Console.WriteLine($"Passive-skill usable coverage: {passiveResult.Coverage.UsablePercent:F2}%");
Console.WriteLine($"Stat-description usable coverage: {statDescriptionResult.Coverage.UsablePercent:F2}%");
Console.WriteLine($"Normalized output: {outputRoot}");

static PairResult<BaseItemRecord> BuildBaseItems(Datc64Table english, Datc64Table translated) {
    var records = new List<BaseItemRecord>();
    for (var row = 0; row < english.RowCount; row += 1) {
        var englishId = english.ReadString(row, 0);
        var translatedId = translated.ReadString(row, 0);
        if (!string.Equals(englishId, translatedId, StringComparison.Ordinal)) {
            throw new InvalidDataException($"BaseItemTypes ID mismatch at row {row}");
        }
        var en = english.ReadString(row, 32).Trim();
        var zh = translated.ReadString(row, 32).Trim();
        if (string.IsNullOrEmpty(englishId) || string.IsNullOrEmpty(en) || en.StartsWith("[DNT", StringComparison.Ordinal)) {
            continue;
        }
        records.Add(new BaseItemRecord(englishId, row, en, zh));
    }
    return CreatePairResult(records, record => record.English, record => record.ZhTW);
}

static PairResult<WordRecord> BuildWords(Datc64Table english, Datc64Table translated) {
    var records = new List<WordRecord>();
    for (var row = 0; row < english.RowCount; row += 1) {
        var en = english.ReadString(row, 48);
        var zh = translated.ReadString(row, 48);
        if (string.IsNullOrEmpty(en)) continue;
        records.Add(new WordRecord(
            row,
            english.ReadInt64(row, 0),
            english.ReadHex(row, 0, 16),
            en,
            zh));
    }
    return CreatePairResult(records, record => record.English, record => record.ZhTW);
}

static AffixResult BuildAffixes(Datc64Table english, Datc64Table translated) {
    var records = new List<AffixRecord>();
    for (var row = 0; row < english.RowCount; row += 1) {
        var englishId = english.ReadString(row, ModsIdOffset);
        var translatedId = translated.ReadString(row, ModsIdOffset);
        if (!string.Equals(englishId, translatedId, StringComparison.Ordinal)) {
            throw new InvalidDataException($"Mods ID mismatch at row {row}");
        }

        var englishGenerationType = english.ReadInt32(row, ModsGenerationTypeOffset);
        var translatedGenerationType = translated.ReadInt32(row, ModsGenerationTypeOffset);
        if (englishGenerationType != translatedGenerationType) {
            throw new InvalidDataException($"Mods generation type mismatch at row {row}");
        }
        if (englishGenerationType is not PrefixGenerationType and not SuffixGenerationType) continue;

        var englishDomain = english.ReadInt32(row, ModsDomainOffset);
        var translatedDomain = translated.ReadInt32(row, ModsDomainOffset);
        if (englishDomain != translatedDomain) {
            throw new InvalidDataException($"Mods domain mismatch at row {row}");
        }
        if (englishDomain != ItemModDomain) continue;

        var en = english.ReadString(row, ModsNameOffset).Trim();
        var zh = translated.ReadString(row, ModsNameOffset).Trim();
        if (string.IsNullOrEmpty(englishId) || string.IsNullOrEmpty(en) ||
            en.StartsWith("[DNT", StringComparison.Ordinal)) {
            continue;
        }
        records.Add(new AffixRecord(
            englishId,
            row,
            "item",
            englishGenerationType == PrefixGenerationType ? "prefix" : "suffix",
            en,
            zh));
    }

    var prefixes = records.Where(record => record.GenerationType == "prefix").ToList();
    var suffixes = records.Where(record => record.GenerationType == "suffix").ToList();
    return new AffixResult(
        records,
        CreatePairResult(prefixes, record => record.English, record => record.ZhTW),
        CreatePairResult(suffixes, record => record.English, record => record.ZhTW));
}

static PairResult<ClientStringRecord> BuildClientStrings(
    Datc64Table english,
    Datc64Table translated) {
    const int idOffset = 0;
    const int textOffset = 8;
    if (english.RowSize < textOffset + sizeof(long)) {
        throw new InvalidDataException($"ClientStrings row size is too small: {english.RowSize}");
    }

    var records = new List<ClientStringRecord>();
    for (var row = 0; row < english.RowCount; row += 1) {
        var englishId = english.ReadString(row, idOffset);
        var translatedId = translated.ReadString(row, idOffset);
        if (!string.Equals(englishId, translatedId, StringComparison.Ordinal)) {
            throw new InvalidDataException($"ClientStrings ID mismatch at row {row}");
        }
        var en = english.ReadString(row, textOffset).Trim();
        var zh = translated.ReadString(row, textOffset).Trim();
        if (string.IsNullOrEmpty(englishId) || string.IsNullOrEmpty(en) ||
            en.StartsWith("[DNT", StringComparison.Ordinal)) {
            continue;
        }
        records.Add(new ClientStringRecord(englishId, row, en, zh));
    }
    return CreatePairResult(records, record => record.English, record => record.ZhTW);
}

static PairResult<PassiveSkillRecord> BuildPassiveSkills(Datc64Table english, Datc64Table translated) {
    const int idOffset = 0;
    const int nameOffset = 50;
    var records = new List<PassiveSkillRecord>();
    for (var row = 0; row < english.RowCount; row += 1) {
        var id = english.ReadString(row, idOffset);
        var translatedId = translated.ReadString(row, idOffset);
        if (!string.Equals(id, translatedId, StringComparison.Ordinal)) {
            throw new InvalidDataException($"PassiveSkills ID mismatch at row {row}");
        }
        var en = english.ReadString(row, nameOffset).Trim();
        var zh = translated.ReadString(row, nameOffset).Trim();
        if (string.IsNullOrEmpty(id) || string.IsNullOrEmpty(en) ||
            en.StartsWith("[DNT", StringComparison.Ordinal)) continue;
        records.Add(new PassiveSkillRecord(id, row, en, zh));
    }
    return CreatePairResult(records, record => record.English, record => record.ZhTW);
}

static StatDescriptionResult BuildStatDescriptions(byte[] mainBytes, byte[] passiveBytes) {
    var all = new List<StatDescriptionPair>();
    all.AddRange(ParseCsd(mainBytes, "stat_descriptions.csd"));
    all.AddRange(ParseCsd(passiveBytes, "passive_skill_stat_descriptions.csd"));
    var byEnglish = new SortedDictionary<string, string>(StringComparer.Ordinal);
    var conflicts = new List<PairConflict>();
    foreach (var group in all.GroupBy(pair => pair.English, StringComparer.Ordinal)) {
        var translations = group.Select(pair => pair.ZhTW)
            .Where(value => !string.IsNullOrEmpty(value) && value != group.Key)
            .Distinct(StringComparer.Ordinal).OrderBy(value => value, StringComparer.Ordinal).ToArray();
        if (translations.Length == 1) byEnglish[group.Key] = translations[0];
        else if (translations.Length > 1) conflicts.Add(new PairConflict(group.Key, translations));
    }
    var signedVariants = new SortedDictionary<string, SignedStatVariant>(StringComparer.Ordinal);
    var signedConflicts = new List<SignedStatConflict>();
    foreach (var positiveGroup in all
        .Where(pair => !pair.Negated && !pair.TranslatedNegated &&
            Regex.IsMatch(pair.English, @"\bincreased\b", RegexOptions.IgnoreCase))
        .GroupBy(pair => pair.English, StringComparer.Ordinal)) {
        var candidates = new List<SignedStatVariant>();
        foreach (var positive in positiveGroup) {
            var expectedNegative = Regex.Replace(
                positive.English, @"\bincreased\b", "reduced", RegexOptions.IgnoreCase);
            var negative = all.FirstOrDefault(pair =>
                pair.Source == positive.Source &&
                pair.Block == positive.Block &&
                pair.Negated &&
                pair.TranslatedNegated &&
                string.Equals(pair.English, expectedNegative, StringComparison.OrdinalIgnoreCase));
            if (negative is null || CountPlaceholders(positive.English) != CountPlaceholders(negative.English)) continue;
            candidates.Add(new SignedStatVariant(
                positive.English,
                positive.ZhTW,
                negative.English,
                negative.ZhTW,
                positive.Source,
                positive.Condition,
                negative.Condition,
                true));
        }
        var distinct = candidates.Distinct().OrderBy(candidate => candidate.NegativeEnglish, StringComparer.Ordinal)
            .ThenBy(candidate => candidate.NegativeZhTW, StringComparer.Ordinal).ToArray();
        if (distinct.Length == 1) signedVariants[positiveGroup.Key] = distinct[0];
        else if (distinct.Length > 1) signedConflicts.Add(new SignedStatConflict(positiveGroup.Key, distinct));
    }
    var uniqueEnglish = all.Select(pair => pair.English).Distinct(StringComparer.Ordinal).Count();
    return new StatDescriptionResult(byEnglish, signedVariants, signedConflicts, conflicts,
        new Coverage(all.Count, uniqueEnglish, byEnglish.Count, conflicts.Count,
            Percent(byEnglish.Count, uniqueEnglish)));
}

static IEnumerable<StatDescriptionPair> ParseCsd(byte[] bytes, string source) {
    var text = Encoding.Unicode.GetString(bytes).TrimStart('\uFEFF');
    var lines = text.Split(new[] { "\r\n", "\n" }, StringSplitOptions.None);
    var english = new List<CsdDescriptionVariant>();
    var translated = new List<CsdDescriptionVariant>();
    var inDescription = false;
    var language = "English";
    var block = -1;
    foreach (var raw in lines.Append("description")) {
        var line = raw.Trim();
        if (line.Equals("description", StringComparison.Ordinal)) {
            foreach (var pair in PairDescriptionVariants(english, translated, source, block)) yield return pair;
            english.Clear(); translated.Clear(); inDescription = true; language = "English"; block += 1; continue;
        }
        if (!inDescription) continue;
        if (line.StartsWith("lang \"", StringComparison.Ordinal)) {
            language = line.Contains("Traditional Chinese", StringComparison.Ordinal) ? "Traditional Chinese" : "Other";
            continue;
        }
        var match = Regex.Match(
            line,
            "^(?<condition>\\S+)\\s+\\\"(?<text>(?:\\\\.|[^\\\"])*)\\\"(?<directives>.*)$");
        if (!match.Success) continue;
        var value = NormalizeCsdText(match.Groups["text"].Value);
        if (string.IsNullOrEmpty(value)) continue;
        var condition = match.Groups["condition"].Value;
        var negated = Regex.IsMatch(match.Groups["directives"].Value, @"(?:^|\s)negate\s+1(?:\s|$)");
        var variant = new CsdDescriptionVariant(value, condition, negated);
        if (language == "English") english.Add(variant);
        else if (language == "Traditional Chinese") translated.Add(variant);
    }
}

static IEnumerable<StatDescriptionPair> PairDescriptionVariants(
    IReadOnlyList<CsdDescriptionVariant> english,
    IReadOnlyList<CsdDescriptionVariant> translated,
    string source,
    int block) {
    if (english.Count == 0 || english.Count != translated.Count) yield break;
    for (var index = 0; index < english.Count; index += 1) {
        var en = english[index]; var zh = translated[index];
        if (en.Text == zh.Text || CountPlaceholders(en.Text) != CountPlaceholders(zh.Text)) continue;
        yield return new StatDescriptionPair(
            en.Text,
            zh.Text,
            source,
            block,
            en.Condition,
            en.Negated,
            zh.Negated);
    }
}

static string NormalizeCsdText(string value) {
    value = value.Replace("\\\"", "\"");
    value = Regex.Replace(value, @"\[([^|\]]+)\|([^\]]+)\]", "$2");
    value = Regex.Replace(value, @"\[([^\]]+)\]", "$1");
    value = Regex.Replace(value, @"\{[^}]*\}", "#");
    return Regex.Replace(value, @"\s+", " ").Trim();
}

static int CountPlaceholders(string value) => value.Count(character => character == '#');

static PairResult<T> CreatePairResult<T>(
    List<T> records,
    Func<T, string> getEnglish,
    Func<T, string> getTranslation) {
    var byEnglish = new SortedDictionary<string, string>(StringComparer.Ordinal);
    var conflicts = new List<PairConflict>();
    foreach (var group in records.GroupBy(getEnglish, StringComparer.Ordinal)) {
        var translations = group.Select(getTranslation)
            .Where(value => !string.IsNullOrEmpty(value) && value != group.Key)
            .Distinct(StringComparer.Ordinal)
            .OrderBy(value => value, StringComparer.Ordinal)
            .ToArray();
        if (translations.Length == 1) byEnglish[group.Key] = translations[0];
        else if (translations.Length > 1) conflicts.Add(new PairConflict(group.Key, translations));
    }
    var uniqueEnglish = records.Select(getEnglish).Distinct(StringComparer.Ordinal).Count();
    var coverage = new Coverage(
        records.Count,
        uniqueEnglish,
        byEnglish.Count,
        conflicts.Count,
        Percent(byEnglish.Count, uniqueEnglish));
    return new PairResult<T>(records, byEnglish, conflicts, coverage);
}

static void ValidatePair(Datc64Table english, Datc64Table translated) {
    if (english.RowCount != translated.RowCount || english.RowSize != translated.RowSize) {
        throw new InvalidDataException(
            $"Localized table geometry mismatch: {english.Path} vs {translated.Path}");
    }
}

static void EnsureInsideRepository(string repositoryRoot, string outputRoot) {
    var root = repositoryRoot.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
        + Path.DirectorySeparatorChar;
    var output = outputRoot.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
        + Path.DirectorySeparatorChar;
    if (!output.StartsWith(root, StringComparison.OrdinalIgnoreCase)) {
        throw new ArgumentException("--output must be inside the repository root");
    }
}

static GameFileSnapshot SnapshotGameFile(string path) {
    var info = new FileInfo(path);
    info.Refresh();
    return new GameFileSnapshot(info.Length, info.LastWriteTimeUtc);
}

static double Percent(int translated, int total) => total == 0
    ? 100
    : Math.Round(translated * 100d / total, 2, MidpointRounding.AwayFromZero);

static void WriteJsonAtomic(string path, object value) {
    var options = new JsonSerializerOptions {
        WriteIndented = true,
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };
    var tempPath = path + ".tmp";
    File.WriteAllText(tempPath, JsonSerializer.Serialize(value, options) + Environment.NewLine,
        new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
    File.Move(tempPath, path, overwrite: true);
}

internal sealed record CliOptions(string GgpkPath, string OutputPath, string RepositoryRoot) {
    public static CliOptions Parse(string[] args) {
        var values = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        for (var index = 0; index < args.Length; index += 2) {
            if (index + 1 >= args.Length || !args[index].StartsWith("--", StringComparison.Ordinal)) {
                throw new ArgumentException(
                    "Usage: --ggpk <Content.ggpk> --output <repo path> --repository-root <repo root>");
            }
            values[args[index]] = args[index + 1];
        }
        if (!values.TryGetValue("--ggpk", out var ggpk)) throw new ArgumentException("Missing --ggpk");
        if (!values.TryGetValue("--repository-root", out var root)) {
            throw new ArgumentException("Missing --repository-root");
        }
        return new CliOptions(ggpk, values.GetValueOrDefault("--output", "data"), root);
    }
}

internal sealed record GameFileSnapshot(long Length, DateTime LastWriteTimeUtc);
internal sealed record BaseItemRecord(string Id, int Row, string English, string ZhTW);
internal sealed record WordRecord(int Row, long WordlistReference, string WordlistKeyRaw, string English, string ZhTW);
internal sealed record AffixRecord(
    string Id,
    int Row,
    string Domain,
    string GenerationType,
    string English,
    string ZhTW);
internal sealed record ClientStringRecord(string Id, int Row, string English, string ZhTW);
internal sealed record PassiveSkillRecord(string Id, int Row, string English, string ZhTW);
internal sealed record CsdDescriptionVariant(string Text, string Condition, bool Negated);
internal sealed record StatDescriptionPair(
    string English,
    string ZhTW,
    string Source,
    int Block,
    string Condition,
    bool Negated,
    bool TranslatedNegated);
internal sealed record SignedStatVariant(
    string PositiveEnglish,
    string PositiveZhTW,
    string NegativeEnglish,
    string NegativeZhTW,
    string Source,
    string PositiveCondition,
    string NegativeCondition,
    bool Negate);
internal sealed record SignedStatConflict(string PositiveEnglish, SignedStatVariant[] Variants);
internal sealed record PairConflict(string English, string[] Translations);
internal sealed record Coverage(
    int Records,
    int UniqueEnglish,
    int MappedEnglish,
    int Conflicts,
    double UsablePercent);
internal sealed record PairResult<T>(
    List<T> Records,
    SortedDictionary<string, string> ByEnglish,
    List<PairConflict> Conflicts,
    Coverage Coverage);
internal sealed record AffixResult(
    List<AffixRecord> Records,
    PairResult<AffixRecord> Prefixes,
    PairResult<AffixRecord> Suffixes);
internal sealed record StatDescriptionResult(
    SortedDictionary<string, string> ByEnglish,
    SortedDictionary<string, SignedStatVariant> SignedVariants,
    List<SignedStatConflict> SignedConflicts,
    List<PairConflict> Conflicts,
    Coverage Coverage);
