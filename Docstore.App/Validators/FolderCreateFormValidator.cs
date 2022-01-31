using Docstore.App.Models.Forms;
using FluentValidation;

namespace Docstore.App.Validators
{
    public class FolderCreateFormValidator : AbstractValidator<FolderForm>
    {
        public FolderCreateFormValidator()
        {
            RuleFor(x => x.Name)
                .NotEmpty()
                .MaximumLength(255);
        }
    }
}
