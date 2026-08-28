using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using ExileTradeLens.Ggpk;
using LibBundledGGPK3;

Console.OutputEncoding = Encoding.UTF8;

const string BaseItemsEn = "data/balance/baseitemtypes.datc64";
const string BaseItemsTw = "data/balance/traditional chinese/baseitemtypes.datc64";
const string WordsEn = "data/balance/words.datc64";
const string WordsTw = "data/balance/traditional chinese/words.datc64";
const string ModsEn = "data/balance/mods.datc64";
const string ModsTw = "data/balance/traditional chinese/mods.datc64";

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

var requestedPaths = new[] { BaseItemsEn, BaseItemsTw, WordsEn, WordsTw, ModsEn, ModsTw };
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

var tables = rawTables.ToDictionary(
    pair => pair.Key,
    pair => new Datc64Table(pair.Key, pair.Value),
    StringComparer.OrdinalIgnoreCase);

ValidatePair(tables[BaseItemsEn], tables[BaseItemsTw]);
ValidatePair(tables[WordsEn], tables[WordsTw]);
ValidatePair(tables[ModsEn], tables[ModsTw]);

var baseResult = BuildBaseItems(tables[BaseItemsEn], tables[BaseItemsTw]);
var wordsResult = BuildWords(tables[WordsEn], tables[WordsTw]);
var generatedAt = DateTime.UtcNow.ToString("O");

Directory.CreateDirectory(outputRoot);
WriteJsonAtomic(Path.Combine(outputRoot, "base-items.zh-TW.json"), new {
    schemaVersion = 1,
    generatedAt,
    domain = "base-item",
    source = "paired-local-content-ggpk",
    records = baseResult.Records,
    byEnglish = baseResult.ByEnglish,
    conflicts = baseResult.Conflicts,
    coverage = baseResult.Coverage,
});
WriteJsonAtomic(Path.Combine(outputRoot, "words.zh-TW.json"), new {
    schemaVersion = 1,
    generatedAt,
    domain = "word-component",
    source = "paired-local-content-ggpk",
    records = wordsResult.Records,
    byEnglish = wordsResult.ByEnglish,
    conflicts = wordsResult.Conflicts,
    coverage = wordsResult.Coverage,
});

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
    }),
    coverage = new {
        baseItems = baseResult.Coverage,
        words = wordsResult.Coverage,
        combinedUsablePercent = Percent(
            baseResult.ByEnglish.Count + wordsResult.ByEnglish.Count,
            baseResult.Coverage.UniqueEnglish + wordsResult.Coverage.UniqueEnglish),
    },
};
WriteJsonAtomic(Path.Combine(outputRoot, "manifest.json"), manifest);

Console.WriteLine($"Base-item usable coverage: {baseResult.Coverage.UsablePercent:F2}%");
Console.WriteLine($"Word-component usable coverage: {wordsResult.Coverage.UsablePercent:F2}%");
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
        return new CliOptions(ggpk, values.GetValueOrDefault("--output", "sources/generated/ggpk"), root);
    }
}

internal sealed record GameFileSnapshot(long Length, DateTime LastWriteTimeUtc);
internal sealed record BaseItemRecord(string Id, int Row, string English, string ZhTW);
internal sealed record WordRecord(int Row, long WordlistReference, string WordlistKeyRaw, string English, string ZhTW);
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
