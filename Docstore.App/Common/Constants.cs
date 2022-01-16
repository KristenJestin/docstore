﻿using Docstore.Application.Models;

namespace Docstore.App.Common
{
    public static class Constants
    {
        public static BreadcrumbItem BreadcrumbHome { get; } = new("Home", action: "Index", controller: "Home", icon: @"<path d=""M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z"" />");
        public static BreadcrumbItem BreadcrumbDocumentsHome { get; } = new BreadcrumbItem("Documents", action: "Index", controller: "Documents", icon: @"<path fill-rule=""evenodd"" d=""M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z"" clip-rule=""evenodd"" />");
    }
}
