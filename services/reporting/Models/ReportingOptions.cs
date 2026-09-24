namespace Lodestar.Reporting.Models;

/// <summary>
/// Configuration bound to the <c>Reporting</c> configuration section via the Options pattern.
/// Validated at startup (see <c>Program.cs</c>) so bad configuration fails fast instead of
/// surfacing as runtime surprises on the first report request.
/// </summary>
public sealed class ReportingOptions
{
    /// <summary>Configuration section name bound by the host.</summary>
    public const string SectionName = "Reporting";

    /// <summary>
    /// Root directory under which generated reports are stored as JSON files
    /// (<c>DataDir</c>/reports). Relative paths resolve against the process working directory.
    /// </summary>
    public string DataDir { get; set; } = "data";

    /// <summary>
    /// SLO target in percent applied when a report request omits one. Defaults to 99.9
    /// (the classic "three nines", i.e. an allowance of 0.1% failed requests).
    /// </summary>
    public double DefaultSlo { get; set; } = 99.9;

    /// <summary>Reports older than this many days are deleted by the retention worker.</summary>
    public int RetentionDays { get; set; } = 90;
}
