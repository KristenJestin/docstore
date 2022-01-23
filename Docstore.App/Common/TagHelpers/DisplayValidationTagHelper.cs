using Docstore.App.Common.Extensions;
using Microsoft.AspNetCore.Mvc.Rendering;
using Microsoft.AspNetCore.Mvc.ViewFeatures;
using Microsoft.AspNetCore.Razor.TagHelpers;

namespace Docstore.App.TagHelpers
{
    [HtmlTargetElement(Attributes = "asp-display-validation-for")]
    public class DisplayValidationTagHelper : TagHelper
    {
        public ModelExpression? AspDisplayValidationFor { get; set; }

        [ViewContext, HtmlAttributeNotBound]
        public ViewContext? ViewContext { get; set; }

        public override void Process(TagHelperContext context, TagHelperOutput output)
        {
            if (AspDisplayValidationFor == null || ViewContext == null)
                return;

            var prefix = ViewContext.ViewData.TemplateInfo.HtmlFieldPrefix;
            var name = AspDisplayValidationFor.Name;

            if (!ViewContext.ViewData.ModelState.HasError(GetPropertyName(name, prefix)))
                output.Content.Clear();
        }


        #region privates
        private string GetPropertyName(string name, string prefix)
        {
            if(!string.IsNullOrWhiteSpace(prefix))
                prefix = $"{prefix}."; 

            return prefix + name;
        }
        #endregion
    }
}
