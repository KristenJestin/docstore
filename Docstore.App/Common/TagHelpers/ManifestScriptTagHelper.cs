using Docstore.Application.Models;
using Microsoft.AspNetCore.Mvc.Rendering;
using Microsoft.AspNetCore.Mvc.ViewFeatures;
using Microsoft.AspNetCore.Razor.TagHelpers;

namespace Docstore.App.Common.TagHelpers
{
    [HtmlTargetElement(Attributes = "asp-entry")]
    public class ManifestScriptTagHelper : TagHelper
    {
        private readonly IWebHostEnvironment _environment;

        public ManifestScriptTagHelper(IWebHostEnvironment environment)
        {
            _environment = environment;
        }

        public string? AspEntry { get; set; }


        public override async Task ProcessAsync(TagHelperContext context, TagHelperOutput output)
        {
            if (AspEntry == null)
                return;

            var manifest = await Constants.GetAssets(_environment);
            var asset = manifest[AspEntry];

            if (asset == null)
                return;

            // process
            if (output.TagName == "script")
                output.Content.AppendHtml(ProcessJavascriptAsset(manifest, asset));
            else if (output.TagName == "link")
                output.Content.AppendHtml(ProcessCssAsset(asset));

            // parent
            output.TagName = null;
        }


        #region privates
        private string ProcessJavascriptAsset(Dictionary<string, ManifestAsset> manifest, ManifestAsset asset)
        {
            var html = "";

            if (!string.IsNullOrWhiteSpace(asset.File))
                html += $@"<script type=""module"" src=""/{asset.File}"" defer></script>";

            if (asset.Imports != null && asset.Imports.Any())
                foreach (var import in asset.Imports)
                    html += ProcessJavascriptAsset(manifest, manifest[import]);

            return html;
        }

        private string ProcessCssAsset(ManifestAsset asset)
        {
            var html = "";

            foreach (var css in asset.Css)
                html += $@"<link rel=""stylesheet"" href=""/{css}"" />";

            return html;
        }
        #endregion
    }
}
