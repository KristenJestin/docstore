using Docstore.Application.Models;

namespace Docstore.App.Common
{
    public static class Constants
    {
        public static BreadcrumbItem BreadcrumbHome { get; } = new("Home", action: "Index", controller: "Home", icon: @"<path d=""M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z"" />");
        public static BreadcrumbItem BreadcrumbDocumentsHome { get; } = new BreadcrumbItem("Documents", action: "Index", controller: "Documents", icon: @"<path d=""M9 2a2 2 0 00-2 2v8a2 2 0 002 2h6a2 2 0 002-2V6.414A2 2 0 0016.414 5L14 2.586A2 2 0 0012.586 2H9z"" /><path d=""M3 8a2 2 0 012-2v10h8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z"" />");
    }
}
